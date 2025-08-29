// Google Apps Script: rotateDailyPIN.gs
function rotateDailyPIN() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Settings');
  const newPIN = '' + Math.floor(1000 + Math.random()*9000); // 4 digits
  sh.getRange('B2').setValue(newPIN);
  sh.getRange('B3').setValue(new Date()); // Timestamp
}
