MILEAGE TRACKER - TEST DRIVE V2
===============================

WHAT CHANGED IN V2
------------------
1. Current Location now stores GPS coordinates and can convert them to a readable street address.
2. Saved Home and Work locations can be recognised automatically when the GPS position is nearby.
3. Mileage is calculated BEFORE Google Maps opens, so the app no longer depends on browser GPS continuing in the background.
4. The route mileage is pre-filled at journey completion and can be corrected for diversions/detours.
5. GPS start coordinates are retained in the journey record and included in CSV export.
6. Existing Version 1 data is migrated automatically on the same phone/browser.

IMPORTANT - GOOGLE MAPS SETUP
-----------------------------
The app files DO NOT contain your Google API key. This is intentional because a GitHub Pages repository may be public.

On your phone:
1. Update the GitHub repository by replacing index.html, app.js, styles.css, manifest.webmanifest and sw.js with the Version 3 files. Keep the icons folder.
2. Wait for GitHub Pages to deploy (normally a minute or two).
3. Open the installed Mileage Tracker. If it still looks like v1, fully close it and reopen it, or open the GitHub Pages URL in Chrome and refresh. V2 includes a new service-worker cache.
4. Open Settings.
5. Paste your Google Maps Platform API key into the API key field and Save Settings.

For Google route/address features the Google Cloud project should have:
- Maps JavaScript API enabled
- Routes API enabled
- Geocoding API enabled
- Billing enabled for Google Maps Platform

SECURITY
--------
Restrict your Google API key in Google Cloud Console to your GitHub Pages website using a Website / HTTP referrer restriction, for example:
https://YOUR-USERNAME.github.io/*

Also restrict the key to only the APIs the app needs.

The key is stored locally in the browser on each device. It is not written into these app files or uploaded to GitHub by the app.

NO API KEY?
-----------
The app still works. Use ENTER MANUALLY for planned route mileage. Current Location will still capture GPS coordinates, but it cannot turn them into a postal address without the Google service.

TEST ROUTINE
------------
For the first V2 test:
1. Settings: enter Home, Work and Google API key, then Save.
2. New Journey > Current. Confirm that a readable starting address appears.
3. Enter destination > Calculate Route. Confirm mileage looks sensible.
4. Start Journey > Google Maps.
5. On arrival reopen Mileage Tracker > End Journey.
6. Confirm/adjust mileage and save.
7. Check Journey History and Monthly Return.

PRIVACY
-------
Journey data and the Google API key are stored in local browser storage on the device. Clearing Chrome site data or resetting the app removes them. Export records regularly while testing.


VERSION 3 CHANGES
-----------------
- Saved journey mileage now automatically advances Current Odometer.
- If you enter an actual ending odometer, that reading overrides the automatic figure.
- The finish screen clearly compares planned and actual mileage.
- Detours/road closures can be recorded with an adjustment reason.
- Google route calculation now requests TRAFFIC_AWARE_OPTIMAL routing.
- Existing Version 2 and Version 1 browser data are migrated automatically.

UPDATE ON GITHUB PAGES
----------------------
Upload/replace index.html, app.js, styles.css, sw.js, manifest.webmanifest and README.txt.
The icons have not changed, but it is safe to upload them again.
After GitHub Pages deploys, close the installed app fully and reopen it. If Version 3 is not shown under the title, open the GitHub Pages URL in Chrome and refresh once, then reopen the installed app.
