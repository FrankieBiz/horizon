import Foundation
import Testing
@testable import HorizonKit

private let nyc = TimeZone(identifier: "America/New_York")!

@Suite("HorizonDates")
struct HorizonDatesTests {

    private func instant(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        return f.date(from: iso)!
    }

    @Test func localDateRespectsTimezone() {
        // 2026-07-07 01:30 UTC is still 2026-07-06 in New York (21:30 EDT).
        let d = instant("2026-07-07T01:30:00Z")
        #expect(HorizonDates.localDate(from: d, timeZone: nyc) == "2026-07-06")
        #expect(HorizonDates.localDate(from: d, timeZone: TimeZone(identifier: "UTC")!) == "2026-07-07")
    }

    @Test func weekStartIsMonday() {
        // 2026-07-09 is a Thursday; its week starts Monday 2026-07-06.
        let thursday = instant("2026-07-09T15:00:00Z")
        #expect(HorizonDates.weekStart(containing: thursday, timeZone: nyc) == "2026-07-06")
        // A Monday is its own week start.
        let monday = instant("2026-07-06T15:00:00Z")
        #expect(HorizonDates.weekStart(containing: monday, timeZone: nyc) == "2026-07-06")
        // Sunday belongs to the week that started the *previous* Monday.
        let sunday = instant("2026-07-12T15:00:00Z")
        #expect(HorizonDates.weekStart(containing: sunday, timeZone: nyc) == "2026-07-06")
    }

    @Test func startOfDayRoundTrips() {
        let start = HorizonDates.startOfDay("2026-07-06", timeZone: nyc)
        #expect(start != nil)
        #expect(HorizonDates.localDate(from: start!, timeZone: nyc) == "2026-07-06")
        #expect(HorizonDates.startOfDay("garbage", timeZone: nyc) == nil)
    }
}
