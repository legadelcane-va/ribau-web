# Adding products with the Google Form

## How it works

1. A volunteer fills in the form **"Nuovo prodotto RiBau"** from their phone: name, description, category, price and photos.
2. Every night around 5:00 the GitHub workflow **Sync Google Sheets to CSV** ([scripts/sheets_sync.js](../scripts/sheets_sync.js)):
   - adds the new answers to the `Prodotti` sheet with the next free ID, and writes that ID in the **ID assegnato** column next to the answer;
   - downloads their photos, names them `{ID}_1.jpg`, `{ID}_2.jpg`, … and shrinks them to 2000 px;
   - publishes the website, only if something changed (quiet nights cost no Netlify credits);
   - writes any problems in the `Controlli` sheet: products without photos, photos without a product, missing or invalid names, prices and categories, duplicate IDs.
3. Around 7:00 a small script in the spreadsheet ([scripts/controlli-email.gs](../scripts/controlli-email.gs)) emails the problems, only when the list changed since the last email.

Volunteers fix mistakes directly in the `Prodotti` sheet, and delete the row of a sold product as before. To publish right away instead of waiting for the night: GitHub → Actions → Sync Google Sheets to CSV → Run workflow.

## One-time setup

Everything happens logged in as the RiBau Google account (ribaulndc@gmail.com). Do step 2.1 before the new sync runs for the first time, since it needs to write in the spreadsheet.

### 1. Create the form

1. On [forms.google.com](https://forms.google.com) create a blank form titled **Nuovo prodotto RiBau**, with these questions. The sync finds the columns by the start of the question title, so keep these words at the start:

   | Question | Type | Settings |
   |---|---|---|
   | Nome | Short answer | Required |
   | Descrizione | Paragraph | |
   | Categoria | Dropdown | Required. Options exactly as in the sheet: Cappotti e Maglioni, Ciotole, Cucce, Dispositivi medici e igienici, Giochi, Pettorine, Guinzagli e Collari, Trasporti e Sicurezza |
   | Prezzo (€) | Short answer | Required |
   | Foto | File upload | Required. Only images, at most 5 files, 10 MB each |

2. In the form's **Responses** tab choose **Link to Sheets → Select existing spreadsheet** and pick the RiBau spreadsheet. This adds a sheet named **Risposte del modulo 1**; if it's called something else (e.g. "Form Responses 1"), rename it to exactly `Risposte del modulo 1`.
3. Send the form link to the volunteers (a bookmark on the phone works well). Uploading photos requires being logged in to a Google account: the RiBau one or their own.

### 2. Give the sync access

The sync uses the Google service account whose key is saved in the GitHub secret `GOOGLE_SERVICE_ACCOUNT`. Its email looks like `something@project-name.iam.gserviceaccount.com`; it's already listed in the spreadsheet's Share dialog.

1. Spreadsheet → **Share**: change the service account from Viewer to **Editor**, so it can add products and write the `Controlli` sheet.
2. [Google Cloud Console](https://console.cloud.google.com) → the project of the service account → **APIs & Services → Library** → **Google Drive API** → **Enable**.
3. After the first answer with photos, Google Drive has a folder named **Nuovo prodotto RiBau (File responses)**. Share it with the service account as **Viewer**, so the sync can download the photos.

### 3. Email script

1. Spreadsheet → **Extensions → Apps Script**. Replace the code with the content of [scripts/controlli-email.gs](../scripts/controlli-email.gs) and save.
2. **Project Settings** (gear icon) → time zone **(GMT+01:00) Rome**.
3. Choose `installTrigger` in the function menu and press **Run**. Google asks for permissions: allow them (for a personal script it shows "Google hasn't verified this app": choose Advanced → Go to the project).
4. Optional: run `sendTestEmail` to check the email arrives.

Recipients are in cell **B1** of the `Controlli` sheet (created by the first sync), separated by commas. If B1 is empty, the email goes to the RiBau account.

## Trying it on a copy first (optional)

To see the sync work without touching the real sheet or the website:

1. After the form has at least one answer, open the spreadsheet → **File → Make a copy**, ticking **Share it with the same people** (so the service account can open the copy too).
2. Copy the ID of the copy from its address: `https://docs.google.com/spreadsheets/d/`**`THIS-PART`**`/edit`.
3. GitHub → Actions → Sync Google Sheets to CSV → **Run workflow**, pasting the ID in *test_sheet_id*.

The copy gets the imported products and a `Controlli` sheet, the run's summary page lists the problems, and nothing is committed or published.

## Good to know

- An answer is imported once: the sync writes its ID in **ID assegnato**. Don't type in that column. To discard an answer before the night, delete its row.
- IDs are never reused, also after a product is sold.
- The originals of the photos stay in the RiBau Google Drive (15 GB free); the website keeps a 2000 px copy.
- Code pushed to `main` also goes live with the next nightly sync.
- If the sync can't write to the spreadsheet (e.g. the service account is not Editor), the run fails and GitHub emails whoever last changed the schedule in the workflow file. The website keeps working, it just isn't updated until that's fixed.
- GitHub pauses scheduled workflows after 60 days without any activity in the repository. If the catalogue isn't touched for two months, re-enable the workflow in the Actions tab.
