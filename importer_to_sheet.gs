/**
 * ==========================================
 * IMPORTER SCRIPT (Source -> Sheet)
 * ==========================================
 * * FEATURES:
 * 1. Creates/Connects to a Master Sheet.
 * 2. Fetches your YouTube Subscriptions.
 * 3. Writes them to the Sheet.
 * 4. [NEW] SMART RESUME: Handles 5,000+ subscriptions without timing out.
 * 5. [NEW] 1-MINUTE TRIGGER: Runs automatically in small batches.
 */

function setupImporter() {
  try {
    console.log("--- STARTING IMPORTER SETUP ---");

    // 1. Create or Identify the Sheet
    // We save the ID so we don't create a new sheet every time
    let sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    let sheet;

    if (sheetId) {
      try {
        sheet = SpreadsheetApp.openById(sheetId);
        console.log("Found existing sheet.");
      } catch (e) {
        console.log("Old sheet not found. Creating new one.");
        sheetId = null;
      }
    }

    if (!sheetId) {
      const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      const sheetName = "YouTube Backup Sheet (" + timestamp + ")";
      sheet = SpreadsheetApp.create(sheetName);
      sheetId = sheet.getId();
      
      // Setup Headers
      const activeSheet = sheet.getActiveSheet();
      activeSheet.getRange('A1:C1').setValues([['Channel ID', 'Channel Name', 'Channel URL']]);
      activeSheet.getRange('A1:C1').setFontWeight('bold').setBackground('#4285f4').setFontColor('#ffffff');
      activeSheet.setFrozenRows(1);
      
      PropertiesService.getScriptProperties().setProperty('SHEET_ID', sheetId);
      DriveApp.getFileById(sheetId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
    
    // 2. Create Trigger
    createMinuteTrigger('runImporterSync');
    
    console.log("✅ SETUP COMPLETE");
    console.log("Sheet ID: " + sheetId);
    console.log("(Copy this ID for the Exporter script)");
    
    // Run once immediately
    runImporterSync();
    
  } catch (e) {
    console.error("SETUP FAILED: " + e.message);
  }
}

function runImporterSync() {
  const startTime = new Date().getTime();
  const MAX_RUN_TIME = 280000; // 4.5 minutes safety buffer
  
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) return console.error("❌ Run setupImporter first.");

  // Check for saved bookmark (PageToken) from previous run
  let nextPageToken = PropertiesService.getScriptProperties().getProperty('IMPORTER_PAGE_TOKEN');

  if (nextPageToken) {
    console.log("🔄 RESUMING import from saved bookmark...");
  } else {
    console.log("▶️ STARTING import check...");
  }

  try {
    const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    
    // Optimization: If starting fresh, load existing IDs to prevent duplicates.
    // If resuming deeply, we rely on the API, but loading IDs is safer.
    const lastRow = sheet.getLastRow();
    const existingIds = lastRow > 1 ? 
      new Set(sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat()) : new Set();

    do {
      // -- TIME SAFETY CHECK --
      if (new Date().getTime() - startTime > MAX_RUN_TIME) {
        console.warn(`⏳ Time limit reached. Saving bookmark: ${nextPageToken}`);
        PropertiesService.getScriptProperties().setProperty('IMPORTER_PAGE_TOKEN', nextPageToken);
        return; // Stop and wait for next minute trigger
      }

      // -- FETCH FROM YOUTUBE --
      let response;
      try {
        response = YouTube.Subscriptions.list('snippet', {
          mine: true,
          maxResults: 50,
          pageToken: nextPageToken || ''
        });
      } catch (e) {
        console.error("API Error: " + e.message);
        return; // Retry next time
      }

      const items = response.items || [];
      const newSubs = items.filter(sub => !existingIds.has(sub.snippet.resourceId.channelId));

      // -- WRITE BATCH --
      if (newSubs.length > 0) {
        const dataToAdd = newSubs.map(sub => [
          sub.snippet.resourceId.channelId,
          sub.snippet.title,
          'https://youtube.com/channel/' + sub.snippet.resourceId.channelId
        ]);
        
        sheet.getRange(sheet.getLastRow() + 1, 1, dataToAdd.length, 3).setValues(dataToAdd);
        
        // Update local memory so we don't re-add duplicates in the same run
        newSubs.forEach(s => existingIds.add(s.snippet.resourceId.channelId));
        console.log(`Saved batch of ${newSubs.length} channels.`);
      }

      nextPageToken = response.nextPageToken;

    } while (nextPageToken);

    // If loop finishes naturally, we are done
    console.log("✅ Sync Complete. All subscriptions checked.");
    PropertiesService.getScriptProperties().deleteProperty('IMPORTER_PAGE_TOKEN');

  } catch (e) {
    console.error("ERROR: " + e.message);
  }
}

function createMinuteTrigger(funcName) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(funcName).timeBased().everyMinutes(1).create();
}
