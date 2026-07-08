import SwiftUI

/// Account rights live here as buttons, not email requests (privacy policy §5):
/// export everything, delete everything, plus goals and sign-out.
struct SettingsView: View {
    @Environment(AppState.self) private var app
    @State private var exportURL: URL?
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var confirmingDelete = false

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            Form {
                Section("Goals") {
                    Stepper("Sleep need: \(app.sleepNeedMin / 60)h \(app.sleepNeedMin % 60)m",
                            value: $app.sleepNeedMin, in: 300...600, step: 15)
                    Stepper("Protein target: \(app.proteinTargetG)g",
                            value: $app.proteinTargetG, in: 60...300, step: 5)
                    Button("Save goals") { Task { await saveGoals() } }
                }

                Section("Your data") {
                    Button {
                        Task { await exportData() }
                    } label: {
                        Label("Export all my data", systemImage: "square.and.arrow.up")
                    }
                    if let exportURL {
                        ShareLink(item: exportURL) {
                            Label("Share export file", systemImage: "doc.zipper")
                        }
                    }
                    Button(role: .destructive) {
                        confirmingDelete = true
                    } label: {
                        Label("Delete account & all data", systemImage: "trash")
                    }
                }

                Section("About") {
                    Link(destination: URL(string: "https://github.com/frankbisignano/horizon/blob/main/docs/privacy/health-data-privacy-policy.md")!) {
                        Label("Health Data Privacy Policy", systemImage: "hand.raised")
                    }
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev")
                    Text("Horizon provides general wellness information, not medical advice.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button("Sign out", role: .destructive) {
                        app.auth.signOut()
                        app.isAuthenticated = false
                    }
                }

                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.red)
                }
            }
            .navigationTitle("Settings")
            .disabled(busy)
            .confirmationDialog(
                "Delete your account?",
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete everything permanently", role: .destructive) {
                    Task { await deleteAccount() }
                }
            } message: {
                Text("This immediately and irreversibly deletes your account and every piece of health data Horizon holds.")
            }
        }
    }

    private func saveGoals() async {
        guard let token = app.auth.accessToken else { return }
        struct GoalsBody: Encodable {
            let timezone: String
            let goals: Goals
            struct Goals: Encodable { let sleepNeedMin: Int; let proteinTargetG: Int }
        }
        do {
            let _: APIClient.EmptyResponse = try await app.api.put(
                "/v1/profile", body: GoalsBody(
                    timezone: app.timezoneID,
                    goals: .init(sleepNeedMin: app.sleepNeedMin, proteinTargetG: app.proteinTargetG)),
                token: token)
            errorMessage = nil
        } catch {
            errorMessage = "Couldn't save goals — will retry on next sync."
        }
    }

    private func exportData() async {
        guard let token = app.auth.accessToken else { return }
        busy = true
        defer { busy = false }
        do {
            struct Export: Decodable { let exportedAt: String; let data: [String: [AnyJSON]] }
            struct AnyJSON: Decodable {}
            // Fetch raw JSON and write it to a shareable temp file.
            var request = URLRequest(url: APIClient.baseURL.appending(path: "/v1/account/export"))
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, _) = try await URLSession.shared.data(for: request)
            let url = FileManager.default.temporaryDirectory
                .appending(path: "horizon-export-\(Int(Date.now.timeIntervalSince1970)).json")
            try data.write(to: url)
            exportURL = url
            errorMessage = nil
        } catch {
            errorMessage = "Export failed — check your connection."
        }
    }

    private func deleteAccount() async {
        guard let token = app.auth.accessToken else { return }
        busy = true
        defer { busy = false }
        do {
            try await app.api.delete("/v1/account", token: token)
            app.auth.signOut()
            app.isAuthenticated = false
            app.hasCompletedOnboarding = false
            app.hasConsented = false
        } catch {
            errorMessage = "Deletion failed — try again or contact support."
        }
    }
}
