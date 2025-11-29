/**
 * ==========================================
 * EXPORTER SCRIPT (Sheet -> YouTube)
 * ==========================================
 * * FEATURES:
 * 1. Reads the Master Sheet from the Importer.
 * 2. Checks which channels you are missing.
 * 3. Subscribes you to them.
 * 4. [NEW] QUOTA PROTECTION: Saves position if daily limit reached.
 * 5. [NEW] TIME PROTECTION: Saves position if 6-minute limit reached.
 * 6. [NEW] AUTO-RESUME: Automatically picks up where it left off.
 */

function setupExporter() {
  // ▼▼▼ PASTE THE SHEET ID FROM THE IMPORTER OUTPUT HERE ▼▼▼
  const SHEET_ID = "PASTE_SHEET_ID_HERE"; 
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

  if (SHEET_ID.includes("PASTE")) {
    throw new Error("❌ STOP: Paste the Sheet ID in line 18 first.");
  }

  PropertiesService.getScriptProperties().setProperty('TARGET_SHEET_ID', SHEET_ID);
  
  // Reset any previous progress to start fresh
  PropertiesService.getScriptProperties().deleteProperty('LAST_PROCESSED_INDEX');
  
  createMinuteTrigger('runExporterSync');
  
  console.log("✅ SETUP COMPLETE. Starting export process...");
  runExporterSync();
}

function runExporterSync() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('TARGET_SHEET_ID');
  if (!sheetId) return console.error("❌ Run setupExporter first.");

  // --- STATE MANAGEMENT ---
  // We track "Index", which corresponds to the row number in the list
  // If this exists, it means we are resuming from a previous run (Quota or Time limit)
  let lastProcessedIndex = parseInt(PropertiesService.getScriptProperties().getProperty('LAST_PROCESSED_INDEX') || "0");
  
  if (lastProcessedIndex > 0) {
    console.log(`🔄 RESUMING Sync from Channel #${lastProcessedIndex}...`);
  } else {
    console.log(`▶️ STARTING Sync from the beginning...`);
  }

  try {
    // 1. Load Data from Sheet
    const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
    const data = sheet.getRange("A2:A" + sheet.getLastRow()).getValues();
    
    // Filter valid IDs (Remove empty rows or bad data)
    const allTargetIds = data.flat().filter(id => id && id.toString().startsWith("UC"));
    
    // Check if we are already done
    if (lastProcessedIndex >= allTargetIds.length) {
      // Optional: Reset to 0 to check for new additions next time, 
      // or just log that we are waiting. Let's reset to allow continuous updates.
      console.log("✅ All channels processed. Resetting to start to check for new additions...");
      PropertiesService.getScriptProperties().deleteProperty('LAST_PROCESSED_INDEX');
      return;
    }

    // 2. Fetch My Current Subs (To skip what we already have)
    // We do this every run to ensure accuracy and save quota
    console.log("Checking current subscriptions...");
    const myCurrentSubs = new Set(fetchMyCurrentSubIds());

    // 3. Processing Loop
    let successCount = 0;
    const MAX_RUN_TIME = 280000; // 4.5 mins safety buffer
    const startTime = new Date().getTime();

    // Loop starting from our saved index
    for (let i = lastProcessedIndex; i < allTargetIds.length; i++) {
      
      // -- TIME SAFETY CHECK --
      if (new Date().getTime() - startTime > MAX_RUN_TIME) {
        console.warn(`⏳ Time limit reached. Saving position at #${i}`);
        PropertiesService.getScriptProperties().setProperty('LAST_PROCESSED_INDEX', i.toString());
        return; // Stop and wait for next trigger
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
        Utilities.sleep(500); // Polite delay to prevent rate limiting

      } catch (e) {
        // == CRITICAL QUOTA HANDLER ==
        if (e.message.includes('quota')) {
          console.error("🛑 DAILY QUOTA EXCEEDED!");
          console.error(`Saving position at #${i}. Will resume tomorrow automatically.`);
          
          // Save the exact index where we failed so we retry THIS ONE tomorrow
          PropertiesService.getScriptProperties().setProperty('LAST_PROCESSED_INDEX', i.toString());
          return; // STOP EXECUTION COMPLETELY
        }
        
        // Log other errors (like "channel not found") but keep going
        console.error(`Failed to add ${channelId}: ${e.message}`);
      }
    }

    // If loop finishes successfully
    console.log(`✅ Batch Complete. Added ${successCount} channels.`);
    // Save completion state (set to end length)
    PropertiesService.getScriptProperties().setProperty('LAST_PROCESSED_INDEX', allTargetIds.length.toString());

  } catch (e) {
    console.error("CRITICAL ERROR: " + e.message);
  }
}

// Helper: Get list of existing subscriptions to avoid duplicates
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
    } catch (e) { break; }
  } while (nextPageToken);
  return ids;
}

function createMinuteTrigger(funcName) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(funcName).timeBased().everyMinutes(1).create();
}
