// Google Apps Script, runs inside the spreadsheet (not in this repository).
// Emails the problems that the nightly sync (scripts/sheets_sync.js) writes in the "Controlli" sheet,
// only when the list changes, so nobody gets the same email every day.
//
// Setup (once, logged in as the RiBau Google account):
// 1. In the spreadsheet: Extensions > Apps Script, replace the code with this file, save.
// 2. Pick "installTrigger" in the function menu, press Run and allow the permissions it asks for.
// 3. Optional: run "sendTestEmail" to check the email arrives.
// Recipients: cell B1 of the "Controlli" sheet (comma separated). If empty, the RiBau Google account.

const CHECKS_SHEET = 'Controlli';
const FIRST_PROBLEM_ROW = 6;

function sendChecksEmail() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CHECKS_SHEET);
  if (!sheet) return;
  const problems = readProblems(sheet);

  // Remember what was emailed last time, to send again only when the list changes
  const fingerprint = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, problems.join('\n')));
  const properties = PropertiesService.getScriptProperties();
  if (fingerprint === properties.getProperty('lastEmail')) return;
  properties.setProperty('lastEmail', fingerprint);
  if (problems.length === 0) return;

  sendEmail(sheet, `RiBau: ${problems.length === 1 ? '1 problema' : problems.length + ' problemi'} nel catalogo`,
    'Ciao!\n\nIl controllo notturno del catalogo ha trovato:\n\n' +
    problems.map(problem => '• ' + problem).join('\n') +
    '\n\nSi possono sistemare nel foglio "Prodotti":\n' + SpreadsheetApp.getActive().getUrl() +
    '\n\nL\'elenco aggiornato è sempre nella scheda "Controlli". Questa email arriva solo quando l\'elenco cambia.');
}

// Run once: checks every morning between 7 and 8, after the nightly sync
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'sendChecksEmail')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('sendChecksEmail').timeBased().everyDays(1).atHour(7).create();
}

function sendTestEmail() {
  sendEmail(SpreadsheetApp.getActive().getSheetByName(CHECKS_SHEET), 'RiBau: email di prova',
    'Le email con i problemi del catalogo arriveranno a questo indirizzo.');
}

function readProblems(sheet) {
  const rows = sheet.getLastRow() - FIRST_PROBLEM_ROW + 1;
  if (rows <= 0) return [];
  return sheet.getRange(FIRST_PROBLEM_ROW, 1, rows, 1).getDisplayValues().map(row => row[0]).filter(String);
}

function sendEmail(sheet, subject, body) {
  const recipients = (sheet && sheet.getRange('B1').getDisplayValue().trim()) || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(recipients, subject, body);
}
