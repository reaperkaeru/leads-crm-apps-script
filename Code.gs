/***** UTILITIES *****/
function formatPhoneUS_(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (digits.length === 10) {
    return `(${digits.substr(0,3)}) ${digits.substr(3,3)}-${digits.substr(6)}`;
  }
  return raw;
}

/***** CONFIG *****/
const SHEET_ID = '1fk6VErZH8IiOVAnuh84Iwqvgj4GzuDLmkVLXvqd6nEY';
const TARGET_SHEET = 'Leads'; // user may change this to the actual tab later

const NOTES_FOLDER_ID   = '1rtBKEwx9CKQmJP27B1Na846llGwfx_9w';
const ARCHIVE_FOLDER_ID = '1oSh922rTASXlufDssr1i5rsP-t4lF0Pg';

const HEADERS = [
  "Business Type","Business Name","Address","Phone Number","Email",
  "Status","Date Added","Last Updated","Lead ID","Notes Link","Notes Doc ID"
];

const STATUS_VALUES = ["Call","Sale","Backup"];
const TYPE_VALUES = ["Office","Retail","Construction","Restaurant","Warehouse","Medical","Residential","Other"];

/***** CORE UTIL *****/
function getSs_(){ return SpreadsheetApp.openById(SHEET_ID); }
function now_(){ return new Date(); }
function validateEmail_(e){ return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e||'')); }
function columnLetter_(n){ let s=''; while(n){ let m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=(n-m-1)/26;} return s; }
function extractDocId_(url) {
  if (!url) return '';
  const m1 = String(url).match(/\/d\/([a-zA-Z0-9\-_]+)/);
  if (m1 && m1[1]) return m1[1];
  const m2 = String(url).match(/[?&]id=([a-zA-Z0-9\-_]+)/);
  if (m2 && m2[1]) return m2[1];
  return '';
}

/***** SETUP *****/
function ensureSheets_(){
  const ss = getSs_();
  let sh = ss.getSheetByName(TARGET_SHEET);
  if (!sh) sh = ss.insertSheet(TARGET_SHEET);

  // Headers
  const rng = sh.getRange(1,1,1,HEADERS.length);
  const row = rng.getValues()[0];
  const needHeaders = row.join('') === '' || HEADERS.some((h,i)=>row[i]!==h);
  if (needHeaders) rng.setValues([HEADERS]);

  // Data validation
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(STATUS_VALUES, true).setAllowInvalid(false).build();
  sh.getRange(2,6,Math.max(1, sh.getMaxRows()-1),1).setDataValidation(statusRule);

  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(TYPE_VALUES, true).setAllowInvalid(true).build();
  sh.getRange(2,1,Math.max(1, sh.getMaxRows()-1),1).setDataValidation(typeRule);

  // Conditional formatting
  applyCrmFormatting_();

  // Ensure archive exists
  if (!ss.getSheetByName('Leads_Archive')) {
    const arc = ss.insertSheet('Leads_Archive');
    arc.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  }
  return sh;
}

/***** CONDITIONAL FORMATTING *****/
function buildStatusRules_(){
  const sh = getSs_().getSheetByName(TARGET_SHEET);
  const lastRow = Math.max(2, sh.getLastRow());
  const numRows = lastRow - 1;
  if (numRows <= 0) return [];
  const statusRange = sh.getRange(2,6,numRows,1);
  const mk = (txt,bg)=>SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(txt).setBackground(bg).setFontColor('#000').setRanges([statusRange]).build();
  return [ mk('Sale','#ccffcc'), mk('Call','#ffd6d6'), mk('Backup','#fff3b0') ];
}

function buildAgingRules_(){
  const sh = getSs_().getSheetByName(TARGET_SHEET);
  const lastRow = Math.max(2, sh.getLastRow());
  const numRows = lastRow - 1;
  if (numRows <= 0) return [];
  const rangeA = sh.getRange(2, 1, numRows, 5); // A:E
  const rangeB = sh.getRange(2, 7, numRows, 2); // G:H
  const H = 'H';
  const mk = (formula,bg)=>SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula).setBackground(bg).setFontColor('#000')
    .setRanges([rangeA, rangeB]).build();
  return [
    mk(`=AND($${H}2<>"", TODAY()-$${H}2>=120)`, '#4292b3'),
    mk(`=AND($${H}2<>"", TODAY()-$${H}2>=60,  TODAY()-$${H}2<120)`, '#62acc9'),
    mk(`=AND($${H}2<>"", TODAY()-$${H}2>=14,  TODAY()-$${H}2<60)`,  '#cbe9f3'),
    mk(`=AND($${H}2<>"", TODAY()-$${H}2<14)`,  '#edfaff')
  ];
}

function applyCrmFormatting_(){
  const sh = getSs_().getSheetByName(TARGET_SHEET);
  const rules = [...buildAgingRules_(), ...buildStatusRules_()];
  sh.setConditionalFormatRules(rules);
}
function applyAgingCF_(){ applyCrmFormatting_(); }
function applyStatusCF_(){ applyCrmFormatting_(); }

/***** DOCS CREATION *****/
function createLeadDoc_(leadId, name, addr, phone, email, status) {
  const notesFolder = DriveApp.getFolderById(NOTES_FOLDER_ID);
  const docName = `Lead ${leadId} – ${name}`;
  const doc = DocumentApp.create(docName);
  const docFile = DriveApp.getFileById(doc.getId());
  notesFolder.addFile(docFile);
  try { DriveApp.getRootFolder().removeFile(docFile); } catch(e) {}
  const body = doc.getBody();
  body.appendParagraph(`Lead Notes – ${name}`).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph(`Address: ${addr}`);
  body.appendParagraph(`Phone: ${phone}`);
  body.appendParagraph(`Email: ${email || 'NA'}`);
  body.appendParagraph(`Status: ${status}`);
  body.appendParagraph('');
  body.appendParagraph('--- Notes ---');
  return {url: doc.getUrl(), id: doc.getId()};
}

/***** CRUD *****/
function addEntryFromForm(obj){
  const sh = ensureSheets_();
  const type = (obj.type||'').trim();
  const name = (obj.name||'').trim();
  const addr = (obj.address||'').trim();
  const phone = formatPhoneUS_((obj.phone||'').trim());
  const email = (obj.email||'').trim();
  const status = (obj.status||'Call').trim();

  if (!name || !addr || !phone || !type) return {ok:false, message:'Please fill all required fields.'};
  if (email && email.toUpperCase() !== 'NA' && !validateEmail_(email)) return {ok:false, message:'Invalid email.'};
  if (!STATUS_VALUES.includes(status)) return {ok:false, message:'Invalid status.'};

  // Deduplicate by Business Name + Address
  const vals = sh.getDataRange().getValues();
  for (let i=1;i<vals.length;i++){
    if ((String(vals[i][1]||'').trim().toLowerCase()===name.toLowerCase()) &&
        (String(vals[i][2]||'').trim().toLowerCase()===addr.toLowerCase())){
      return {ok:false, message:'Duplicate (same name & address).' };
    }
  }

  const leadId = Utilities.getUuid().slice(0,8);
  const doc = createLeadDoc_(leadId,name,addr,phone,email,status);

  sh.appendRow([type,name,addr,phone,email,status,now_(),now_(),leadId,doc.url,doc.id]);
  applyCrmFormatting_();

  return {ok:true, message:'Lead saved (+ Doc created).'};
}

function updateLead(obj){
  const sh = ensureSheets_();
  const row = parseInt(obj.rowNumber,10);
  if (!row || row<2 || row>sh.getLastRow()) return {ok:false,message:'Invalid row.'};

  const current = sh.getRange(row,1,1,HEADERS.length).getValues()[0];
  const dateAdded = current[6] || now_();
  const type = (obj.type||'').trim();
  const name = (obj.name||'').trim();
  const addr = (obj.address||'').trim();
  const phone = formatPhoneUS_((obj.phone||'').trim());
  const email = (obj.email||'').trim();
  const status = (obj.status||'Call').trim();

  if (!name || !addr || !phone || !type) return {ok:false, message:'Please fill all required fields.'};
  if (email && email.toUpperCase() !== 'NA' && !validateEmail_(email)) return {ok:false, message:'Invalid email.'};
  if (!STATUS_VALUES.includes(status)) return {ok:false, message:'Invalid status.'};

  const vals = sh.getDataRange().getValues();
  const key = (name+'|'+addr).toLowerCase();
  for (let i=1;i<vals.length;i++){
    const r=i+1; if (r===row) continue;
    const k=((vals[i][1]||'')+'|'+(vals[i][2]||'')).toLowerCase();
    if (k===key) return {ok:false, message:'Another lead with the same name & address exists.'};
  }

  sh.getRange(row,1,1,HEADERS.length).setValues([[type,name,addr,phone,email,status,dateAdded,now_(),current[8],current[9],current[10]]]);
  applyCrmFormatting_();
  return {ok:true, message:'Lead updated.'};
}

/***** EXPORT *****/
function getLeadsCsv(){
  const sh = ensureSheets_();
  const vals = sh.getDataRange().getValues();
  if (vals.length===0) return {filename:'leads.csv', csv:''};
  const esc = v => `"${String(v==null?'':v).replace(/"/g,'""')}"`;
  const csv = vals.map(r=>r.slice(0,HEADERS.length).map(esc).join(',')).join('\r\n');
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  return {filename:`leads_${ts}.csv`, csv};
}

/***** ARCHIVE / DELETE *****/
function getSelectedRows_() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== TARGET_SHEET) throw new Error('Select rows on the "Leads" sheet.');
  const sel = sh.getActiveRange();
  if (!sel) throw new Error('Select at least one row.');
  const rows = [];
  for (let r = sel.getRow(); r < sel.getRow() + sel.getNumRows(); r++) {
    if (r >= 2 && r <= sh.getLastRow()) rows.push(r);
  }
  return rows;
}

function moveFileToFolder_(fileId, folderId) {
  const file = DriveApp.getFileById(fileId);
  const target = DriveApp.getFolderById(folderId);
  target.addFile(file);
  const parents = file.getParents();
  while (parents.hasNext()) {
    const p = parents.next();
    if (p.getId() !== folderId) p.removeFile(file);
  }
}

function archiveSelected() {
  const ss = getSs_();
  const sh = ss.getSheetByName(TARGET_SHEET);
  const arc = ss.getSheetByName('Leads_Archive') || ss.insertSheet('Leads_Archive');

  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  if (arc.getLastRow() === 0) arc.getRange(1,1,1,headers.length).setValues([headers]);

  const idx = (h)=> headers.indexOf(h)+1;
  const rows = getSelectedRows_().sort((a,b)=>b-a);
  let moved=0;
  rows.forEach(r=>{
    const vals = sh.getRange(r,1,1,headers.length).getValues()[0];
    const docId = vals[idx('Notes Doc ID')-1] || extractDocId_(vals[idx('Notes Link')-1]);
    if (docId) { try{ moveFileToFolder_(docId, ARCHIVE_FOLDER_ID); }catch(e){} }
    arc.appendRow(vals);
    sh.deleteRow(r);
    moved++;
  });
  SpreadsheetApp.getUi().alert(`Archived ${moved} lead(s).`);
}

function deleteSelectedHard() {
  const ss = getSs_();
  const sh = ss.getSheetByName(TARGET_SHEET);
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const idx = (h)=> headers.indexOf(h)+1;
  const rows = getSelectedRows_().sort((a,b)=>b-a);
  let del=0;
  rows.forEach(r=>{
    const vals = sh.getRange(r,1,1,headers.length).getValues()[0];
    const docId = vals[idx('Notes Doc ID')-1] || extractDocId_(vals[idx('Notes Link')-1]);
    if (docId) { try{ DriveApp.getFileById(docId).setTrashed(true); }catch(e){} }
    sh.deleteRow(r);
    del++;
  });
  SpreadsheetApp.getUi().alert(`Deleted ${del} lead(s).`);
}

/***** SIDEBAR & MENU *****/
function showLeadsApp(){
  const html = HtmlService.createTemplateFromFile('Sidebar').evaluate().setTitle('Client Manager');
  SpreadsheetApp.getUi().showSidebar(html);
}
function doGet(){
  ensureSheets_();
  return HtmlService.createTemplateFromFile('Sidebar').evaluate().setTitle('My Cleaning CRM');
}
function onOpen(){
  ensureSheets_();
  SpreadsheetApp.getUi()
    .createMenu('Leads App')
    .addItem('Open Sidebar','showLeadsApp')
    .addSeparator()
    .addItem('Archive selected row(s)','archiveSelected')
    .addItem('Delete selected row(s) (hard)','deleteSelectedHard')
    .addToUi();
}

/***** DEBUG *****/
function healthCheck(){
  try{
    const ss=getSs_();
    const sh=ss.getSheetByName(TARGET_SHEET)||ss.insertSheet(TARGET_SHEET);
    return {ok:true,fileId:ss.getId(),fileName:ss.getName(),sheetName:sh.getName(),lastRow:sh.getLastRow()};
  }catch(err){ return {ok:false,message:String(err&&err.message||err)}; }
}
