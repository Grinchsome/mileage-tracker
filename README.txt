Mileage Tracker - Test Drive V4

WHAT CHANGED IN V4
------------------
- Company export is now a real .xlsx workbook.
- The workbook follows the supplied Stage Electrics Vehicle Mileage Return layout.
- Driver name, vehicle registration, month, odometer readings and business journeys are filled automatically.
- Business mileage is populated from the app's journey records.
- Private mileage is calculated as total van mileage less total business mileage, matching the company declaration logic.
- Signature / H.O.D. / Management Team fields remain blank for normal sign-off.
- If more than 31 business journeys exist in the month, continuation sheets are added.
- Existing V3 data/settings/API key migrate automatically on the same device/browser.

SHARING THE APP
---------------
The Google Maps API key is stored in localStorage on each device. Sharing the GitHub Pages URL does not share your key automatically. Each colleague can use the app without Google features until a key is entered on that device. If colleagues enter your key, their Google Maps requests are charged/count against your Google Cloud project.

UPDATE ON GITHUB
----------------
Upload these V4 files over the files already in your mileage-tracker repository. Wait for GitHub Pages to deploy, then close and reopen the installed app. The header should show Test Drive v4.
