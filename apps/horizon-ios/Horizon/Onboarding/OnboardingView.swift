import SwiftUI
import AuthenticationServices

/// Stage-1 onboarding: consent → Sign in with Apple → HealthKit permission.
/// (Goals step and visual polish land in Stage 5.)
struct OnboardingView: View {
    @Environment(AppState.self) private var app
    @State private var step: Step = .consent
    @State private var errorMessage: String?

    enum Step { case consent, signIn, health, goals }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            switch step {
            case .consent: consent
            case .signIn: signIn
            case .health: health
            case .goals: goals
            }
            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(.red)
            }
            Spacer()
        }
        .padding(24)
        .onAppear {
            if app.hasConsented { step = app.isAuthenticated ? .health : .signIn }
        }
    }

    private var consent: some View {
        VStack(spacing: 16) {
            Text("Horizon").font(.largeTitle.bold())
            Text("A weekly coach built on your own data.")
                .font(.title3).foregroundStyle(.secondary)
            Text("""
            Horizon collects health data — sleep, heart rate, activity, workouts, \
            nutrition, and anything you log — solely to write your weekly coaching \
            review. It is never used for advertising, never sold, and never shared \
            beyond the processors named in the Health Data Privacy Policy. Horizon \
            provides general wellness guidance, not medical advice.
            """)
            .font(.callout)
            .multilineTextAlignment(.leading)
            Button {
                app.hasConsented = true
                step = .signIn
            } label: {
                Text("I agree — continue").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private var signIn: some View {
        VStack(spacing: 16) {
            Text("Create your account").font(.title2.bold())
            SignInWithAppleButton(.signIn) { request in
                request.requestedScopes = []
            } onCompletion: { result in
                switch result {
                case .success(let authorization):
                    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                          let tokenData = credential.identityToken,
                          let idToken = String(data: tokenData, encoding: .utf8) else {
                        errorMessage = "Apple sign-in returned no identity token."
                        return
                    }
                    Task {
                        do {
                            try await app.auth.signIn(withAppleIDToken: idToken)
                            app.isAuthenticated = true
                            errorMessage = nil
                            step = .health
                        } catch {
                            errorMessage = "Sign-in failed. Check your connection and try again."
                        }
                    }
                case .failure:
                    errorMessage = "Sign-in was cancelled."
                }
            }
            .frame(height: 50)
        }
    }

    private var health: some View {
        VStack(spacing: 16) {
            Text("Connect Apple Health").font(.title2.bold())
            Text("""
            Horizon reads sleep, resting heart rate, heart-rate variability, \
            respiratory rate, steps, active energy, workouts, and nutrition. \
            You choose exactly what to share on the next screen.
            """)
            .font(.callout)
            Button {
                Task {
                    try? await app.healthKit.requestAuthorization()
                    // Read-authorization status is unknowable by design — proceed
                    // either way; missing data renders as empty state.
                    step = .goals
                }
            } label: {
                Text("Connect Health").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            Button("Skip for now") { step = .goals }
                .font(.footnote)
        }
    }

    private var goals: some View {
        @Bindable var app = app
        return VStack(spacing: 16) {
            Text("Your targets").font(.title2.bold())
            Text("The coach measures your weeks against these — adjust anytime in Settings.")
                .font(.callout).foregroundStyle(.secondary)
            Form {
                Stepper("Sleep need: \(app.sleepNeedMin / 60)h \(app.sleepNeedMin % 60)m",
                        value: $app.sleepNeedMin, in: 300...600, step: 15)
                Stepper("Protein target: \(app.proteinTargetG)g",
                        value: $app.proteinTargetG, in: 60...300, step: 5)
            }
            .frame(height: 160)
            .scrollDisabled(true)
            Button {
                Task {
                    await saveProfile()
                    app.hasCompletedOnboarding = true
                    await app.onLaunch()
                }
            } label: {
                Text("Start Horizon").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func saveProfile() async {
        guard let token = app.auth.accessToken else { return }
        struct ProfileBody: Encodable {
            let timezone: String
            let goals: Goals
            struct Goals: Encodable { let sleepNeedMin: Int; let proteinTargetG: Int }
        }
        let _: APIClient.EmptyResponse? = try? await app.api.put(
            "/v1/profile",
            body: ProfileBody(timezone: app.timezoneID,
                              goals: .init(sleepNeedMin: app.sleepNeedMin,
                                           proteinTargetG: app.proteinTargetG)),
            token: token)
    }
}
