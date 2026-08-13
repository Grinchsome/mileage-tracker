Mileage Tracker - Test Drive V5.4

PATCH
Fixes the company XLSX export so Excel opens the generated workbook without repairing sheet XML. Also removes the stale calculation-chain part from the generated workbook. Existing settings and journey data are preserved.

WHAT CHANGED IN V5
------------------
- Company .XLSX export now starts from the exact company workbook template supplied for this project, preserving its original layout, colours, borders, formulas, header, signature area and print setup.
- Driver name, vehicle registration, month, monthly odometer readings and business journeys are inserted into the existing template cells.
- The company form continues to calculate total business mileage and private mileage using the original declaration logic.
- Export CSV and Export Company .XLSX buttons now show PREPARING... and DOWNLOADED with a visible success state, and are disabled while the download is being prepared to prevent accidental double downloads.
- Reset journey data now clears journey/test records while keeping driver/van settings, Home and Work locations, Google API key and current odometer. The current odometer becomes the new monthly starting point.
- Existing V4 data/settings/API key migrate automatically on the same device/browser.

COMPANY EXPORT
--------------
The supplied company form contains 31 business-journey lines. V5 preserves that exact form. If a month contains more than 31 business journeys, V5 will warn rather than silently omit them.

UPDATE ON GITHUB
----------------
Upload all V5 files over the files already in your mileage-tracker repository. Wait for GitHub Pages to deploy, then fully close and reopen the installed app. The header should show Test Drive v5.4

If the installed app still shows V4, open the GitHub Pages address in Chrome, refresh it once, then reopen the installed app.

SHARING THE APP
---------------
The Google Maps API key remains stored locally on each device. Sharing the GitHub Pages URL does not automatically share your key.


V5.4 changes
------------
- Adds a Delete button to every Journey History entry.
- Deleting requires confirmation and removes only that journey from history, monthly totals and exports.
- Deleting a journey does not alter the current van odometer.
- Company XLSX export can reconstruct missing/inconsistent legacy journey odometer readings from chronological recorded mileage, including Personal trips between Work trips.


V5.4 CHANGES
- Current Odometer is now treated as the live running value and advances by the saved actual journey mileage.
- Month End Odometer follows the running Current Odometer after each saved journey.
- A manual Current Odometer correction in Settings becomes authoritative and is recorded as the latest correction.
- Company XLSX journey details use concise road/location names (text before the first comma), while full Google addresses remain stored in the app/history.
