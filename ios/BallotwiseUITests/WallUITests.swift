import XCTest

/// Drives the iPad wall with real touches: taps into states, districts and counties, switches lenses, draws and
/// comes back. Needs the live API. Screenshots go to $SHOTS (pass TEST_RUNNER_SHOTS to xcodebuild).
final class WallUITests: XCTestCase {
    private let shots = ProcessInfo.processInfo.environment["SHOTS"] ?? NSTemporaryDirectory()

    @MainActor private func shot(_ name: String) {
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: shots).appendingPathComponent("\(name).png"))
    }

    @MainActor func testWallByTouch() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("The wall is iPad only.") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-BWTab", "wall"]
        app.launch()
        let map = app.descendants(matching: .any)["wallMap"]
        let backButton = app.buttons["United States"]
        /// Picks `item` from one of the pill menus over the map.
        func choose(_ menu: String, _ item: String) {
            app.buttons[menu].tap()
            let option = app.collectionViews.buttons[item]
            XCTAssertTrue(option.waitForExistence(timeout: 3), "\(item) is in the \(menu) menu")
            option.tap()
        }

        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(map.waitForExistence(timeout: 30), "map loads")
        shot("1-nation")

        // A tap in the middle of the country flies into a state.
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(backButton.waitForExistence(timeout: 5), "a state opens")
        backButton.tap()
        XCTAssertFalse(backButton.waitForExistence(timeout: 2), "back to the country")

        // A race picked from the rail opens its state's counties.
        let kansas = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Kansas Senate'")).firstMatch
        XCTAssertTrue(kansas.waitForExistence(timeout: 10), "Kansas is a race to watch")
        kansas.tap()
        XCTAssertTrue(app.staticTexts["Kansas"].waitForExistence(timeout: 5))
        let hint = app.staticTexts["Tap a county for its results. Pinch out to go back."]
        XCTAssertTrue(hint.waitForExistence(timeout: 5))
        sleep(2)
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(hint.waitForNonExistence(timeout: 10), "a county is picked")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '2024 president'")).firstMatch.waitForExistence(timeout: 5),
                      "the county's card shows")
        shot("2-kansas-county")

        choose("Shade by", "2024")
        shot("3-kansas-2024")
        choose("Shade by", "Swing")

        // The pen draws over the map, then clears.
        app.buttons["Draw on the map"].tap()
        let from = map.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3))
        from.press(forDuration: 0.05, thenDragTo: map.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.6)))
        shot("4-kansas-drawn")
        app.buttons["Clear drawing"].tap()
        app.buttons["Stop drawing"].tap()

        // Pinching out of a state goes back to the country.
        map.pinch(withScale: 0.4, velocity: -1)
        XCTAssertTrue(backButton.waitForNonExistence(timeout: 5), "a pinch out leaves the state")
        choose("Shade by", "Forecast")
        shot("5-nation-forecast")

        // House: a tapped district opens its state with that race on the rail.
        choose("Office", "House")
        choose("Shade by", "Results")
        sleep(4)
        shot("6-house")
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(backButton.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Full race page"].waitForExistence(timeout: 5), "the district's race shows")
        shot("7-house-state")
        app.buttons["Full race page"].tap()
        XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 5), "race page opens")
        shot("8-race-page")

        XCUIDevice.shared.orientation = .portrait
    }

    /// The phone's wall: the map on top, the results in a sheet under it.
    @MainActor func testWallOnPhone() throws {
        guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone layout.") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-BWTab", "wall"]
        app.launch()
        let map = app.descendants(matching: .any)["wallMap"]
        let backButton = app.buttons["United States"]
        XCTAssertTrue(map.waitForExistence(timeout: 30), "map loads")
        shot("p1-nation")

        // Pull the sheet up to the races to watch, and pick one: the sheet drops and the map flies in.
        app.buttons["Show more results"].tap()
        let kansas = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Kansas Senate'")).firstMatch
        XCTAssertTrue(kansas.waitForExistence(timeout: 10))
        shot("p2-sheet-up")
        kansas.tap()
        XCTAssertTrue(backButton.waitForExistence(timeout: 5), "Kansas opens")
        sleep(2)
        shot("p3-kansas")
        map.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55)).tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '2024 president'")).firstMatch.waitForExistence(timeout: 10),
                      "the county's card shows")
        shot("p4-county")

        // A gentler pinch keeps the test's fingers on the short map, off the sheet's handle below it.
        // XCUITest's pinch starts its fingers at the map's edges, and on a phone one lands on the sheet's handle, so
        // the pinch out is covered by the iPad test; here the back pill goes home.
        backButton.tap()
        XCTAssertTrue(backButton.waitForNonExistence(timeout: 5), "back to the country")
    }
}
