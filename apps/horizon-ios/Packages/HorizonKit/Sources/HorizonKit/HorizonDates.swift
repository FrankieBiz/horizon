import Foundation

/// Date helpers for user-timezone day and week boundaries.
/// Week starts Monday, per the design decision (spec §11 Q5).
public enum HorizonDates {

    /// "yyyy-MM-dd" for the given instant in the given timezone.
    public static func localDate(from date: Date, timeZone: TimeZone) -> LocalDate {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// The Monday that starts the week containing `date`, as a LocalDate.
    public static func weekStart(containing date: Date, timeZone: TimeZone) -> LocalDate {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.firstWeekday = 2 // Monday
        let comps = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)
        let monday = calendar.date(from: comps)!
        return localDate(from: monday, timeZone: timeZone)
    }

    /// Parse a LocalDate back to the instant of local midnight in the given timezone.
    public static func startOfDay(_ localDate: LocalDate, timeZone: TimeZone) -> Date? {
        let parts = localDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        var c = DateComponents()
        c.year = parts[0]; c.month = parts[1]; c.day = parts[2]
        return calendar.date(from: c)
    }
}
