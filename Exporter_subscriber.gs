/**
 * ==========================================
 * EXPORTER SCRIPT (Sheet -> YouTube)
 * ==========================================
 * * FEATURES:
 * 1. Reads the Master Sheet from the Importer.
 * 2. Checks which channels you are missing.
 * 3. Subscribes you to them.
 * 4. [FIXED] STRICT QUOTA GUARD: Ensures bookmark is NEVER lost on Quota error.
 * 5. [FIXED] GLOBAL CHECK: Detects quota failure before loop starts.
 */

function setupExporter() {
  // ▼▼▼ PASTE THE SHEET ID FROM THE IMPORTER OUTPUT HERE ▼▼▼
  const SHEET_ID = "PASTE_SHEET_ID_HERE"; 
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

  if (SHEET_ID.includes("PASTE")) {
    throw new Error("❌ STOP: Paste the Sheet ID in line 16 first.");
  }

  PropertiesService.getScriptProperties().setProperty('TARGET_SHEET_ID', SHEET_ID);
  
  // Only reset if explicitly running setup
  PropertiesService.getScriptProperties().deleteProperty('LAST_PROCESSED_INDEX');
  
  createHourlyTrigger('runExporterSync');
  
  console.log("✅ SETUP COMPLETE. Starting export process...");
  runExporterSync();
}

function runExporterSync() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('TARGET_SHEET_ID');
  if (!sheetId) return console.error("❌ Run setupExporter first.");

  // --- STATE MANAGEMENT ---
  let lastProcessedIndex = parseInt(PropertiesService.getScriptProperties().getProperty('LAST_PROCESSED_INDEX') || "0");
  
  console.log(`🔎 Checking status. Current Bookmark: #${lastProcessedIndex}`);

  try {
    // 1. Load Data from Sheet
    const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    const data = sheet.getRange("A2:A" + sheet.getLastRow()).getValues();
    const allTargetIds = data.flat().filter(id => id && id.toString().startsWith("UC"));
    
    // 2. GLOBAL QUOTA CHECK (Crucial Step)
    // We try to fetch current subs first. If this fails due to Quota, we MUST STOP.
    // We cannot proceed, or we risk resetting the index erroneously.
    let myCurrentSubs;
    try {
      console.log("Checking current subscriptions...");
      myCurrentSubs = new Set(fetchMyCurrentSubIds());
    } catch (e) {
      if (e.message.includes('quota')) {
        console.error("🛑 DAILY QUOTA EXCEEDED (During Pre-check)!");
        console.error(`Frozen at #${lastProcessedIndex}. Sleeping until tomorrow.`);
        return; // STOP HERE. Do not touch the bookmark.
      }
      throw e; // Throw other errors
    }

    // 3. Check if done (Only if Quota check passed)
    if (lastProcessedIndex >= allTargetIds.length) {
      console.log(`✅ All ${allTargetIds.length} channels processed. Resetting to 0 to check for new additions...`);
      PropertiesService.getScriptProperties().deleteProperty('LAST_PROCESSED_INDEX');
      return;
    }

    console.log(`▶️ Processing channels from #${lastProcessedIndex} to #${allTargetIds.length}...`);

    // 4. Processing Loop
    let successCount = 0;
    const MAX_RUN_TIME = 280000; // 4.5 mins safety buffer
    const startTime = new Date().getTime();

    for (let i = lastProcessedIndex; i < allTargetIds.length; i++) {
      
      // -- TIME SAFETY CHECK --
      if (new Date().getTime() - startTime > MAX_RUN_TIME) {
        console.warn(`⏳ Time limit reached. Saving position at #${i}`);
        PropertiesService.getScriptProperties().setProperty('LAST_PROCESSED_INDEX', i.toString());
        return; 
      }

      const channelId = allTargetIds[i];

      // Skip if already subscribed
      if (myCurrentSubs.has(channelId)) {
        continue; 
      }

      // -- SUBSCRIBE ATTEMPT --
      try {
        YouTube.Subscriptions.insert({
          snippet: { resourceId: { kind: 'youtube#channel', channelId: channelId } }
        }, 'snippet');
        
        successCount++;
        console.log(`[${i + 1}/${allTargetIds.length}] Subscribed to: ${channelId}`);
        Utilities.sleep(500); 

      } catch (e) {
        // == CRITICAL QUOTA HANDLER ==
        if (e.message.includes('quota')) {
          console.error("🛑 DAILY QUOTA EXCEEDED (During Subscribe)!");
          console.error(`Saving position at #${i}. Will resume tomorrow.`);
          
          // Save the exact index where we failed
          PropertiesService.getScriptProperties().setProperty('LAST_PROCESSED_INDEX', i.toString());
          return; // STOP EXECUTION
        }
        
        console.error(`Failed to add ${channelId}: ${e.message}`);
      }
    }

    // If loop finishes successfully
    console.log(`✅ Batch Complete. Added ${successCount} channels.`);
    // Save completion state
    PropertiesService.getScriptProperties().setProperty('LAST_PROCESSED_INDEX', allTargetIds.length.toString());

  } catch (e) {
    if (e.message.includes('quota')) {
      console.error("🛑 QUOTA HIT (General Error). Freezing state.");
      return;
    }
    console.error("CRITICAL ERROR: " + e.message);
  }
}

// Helper: Get list of existing subscriptions
// UPDATED: Now throws error on quota failure instead of swallowing it
function fetchMyCurrentSubIds() {
  let ids = [];
  let nextPageToken = '';
  do {
    try {
      const response = YouTube.Subscriptions.list('snippet', {
        mine: true,
        maxResults: 50,
        pageToken: nextPageToken,
        fields: 'nextPageToken,items(snippet(resourceId(channelId)))'
      });
      if (response.items) {
        ids = ids.concat(response.items.map(item => item.snippet.resourceId.channelId));
      }
      nextPageToken = response.nextPageToken;
    } catch (e) {
      if (e.message.includes('quota')) throw e; // Pass quota error up to main function
      console.warn("API Warning: " + e.message);
      break; 
    }
  } while (nextPageToken);
  return ids;
}

function createHourlyTrigger(funcName) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(funcName).timeBased().everyHours(5).create();
}
