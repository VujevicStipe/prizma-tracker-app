const admin = require('firebase-admin');
const fs = require('fs');
const xml2js = require('xml2js');
const path = require('path');

// Load service account key
const serviceAccount = require(path.join(__dirname, '../serviceAccountKey.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// ============================================
// UTILITY FUNCTIONS
// ============================================

function generateId(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 50);
}

function extractColor(styleUrl) {
  if (!styleUrl) return '#10B981';
  
  const colorMatch = styleUrl.match(/poly-([A-F0-9]{6})-/i);
  if (colorMatch) {
    return `#${colorMatch[1]}`;
  }
  return '#10B981';
}

// ============================================
// BACKUP FUNCTION
// ============================================

async function backupFirestore() {
  console.log('[BACKUP] Starting Firestore backup...\n');
  
  const backup = {
    workers: [],
    territories: [],
    sessions: [],
    timestamp: new Date().toISOString()
  };

  try {
    const workersSnapshot = await db.collection('workers').get();
    workersSnapshot.forEach(doc => {
      backup.workers.push({ id: doc.id, ...doc.data() });
    });
    console.log(`[BACKUP] Workers: ${backup.workers.length}`);

    const territoriesSnapshot = await db.collection('territories').get();
    territoriesSnapshot.forEach(doc => {
      backup.territories.push({ id: doc.id, ...doc.data() });
    });
    console.log(`[BACKUP] Territories: ${backup.territories.length}`);

    const sessionsSnapshot = await db.collection('sessions').get();
    sessionsSnapshot.forEach(doc => {
      backup.sessions.push({ id: doc.id, ...doc.data() });
    });
    console.log(`[BACKUP] Sessions: ${backup.sessions.length}`);

    const backupFilename = `firestore_backup_${Date.now()}.json`;
    fs.writeFileSync(backupFilename, JSON.stringify(backup, null, 2));
    console.log(`[BACKUP] Saved: ${backupFilename}\n`);
    
    return { filename: backupFilename, data: backup };
  } catch (error) {
    console.error('[ERROR] Backup failed:', error);
    throw error;
  }
}

// ============================================
// KML PARSING
// ============================================

async function parseKML(kmlPath) {
  console.log('[PARSE] Reading KML file...\n');
  
  if (!fs.existsSync(kmlPath)) {
    throw new Error(`KML file not found: ${kmlPath}`);
  }
  
  const kmlContent = fs.readFileSync(kmlPath, 'utf8');
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(kmlContent);
  
  const folders = result.kml.Document[0].Folder || [];
  const territories = [];
  
  for (const folder of folders) {
    const folderName = folder.name ? folder.name[0] : 'Unnamed';
    const placemarks = folder.Placemark || [];
    
    console.log(`[PARSE] Folder: ${folderName} (${placemarks.length} placemarks)`);
    
    for (const placemark of placemarks) {
      const name = placemark.name[0].trim();
      const description = placemark.description ? placemark.description[0] : null;
      const styleUrl = placemark.styleUrl ? placemark.styleUrl[0] : null;
      
      let coordinates = [];
      
      // Handle Polygon
      if (placemark.Polygon) {
        const coordsString = placemark.Polygon[0].outerBoundaryIs[0]
          .LinearRing[0].coordinates[0];
        coordinates = coordsString
          .trim()
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .map(line => {
            const [lon, lat] = line.split(',').map(parseFloat);
            return [lon, lat];
          })
          .filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
      }
      // Handle MultiGeometry (multiple polygons)
      else if (placemark.MultiGeometry) {
        const polygons = placemark.MultiGeometry[0].Polygon || [];
        if (polygons.length > 0) {
          console.log(`[WARN] ${name} has MultiGeometry (${polygons.length} polygons) - using first polygon only`);
          const coordsString = polygons[0].outerBoundaryIs[0]
            .LinearRing[0].coordinates[0];
          coordinates = coordsString
            .trim()
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
              const [lon, lat] = line.split(',').map(parseFloat);
              return [lon, lat];
            })
            .filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
        }
      }
      
      if (coordinates.length === 0) {
        console.log(`[SKIP] ${name} - no valid coordinates`);
        continue;
      }
      
      let flyerCount = null;
      if (description) {
        const match = description.match(/(\d+)\s*kom/i);
        if (match) {
          flyerCount = parseInt(match[1]);
        }
      }
      
      const geoJSON = {
        type: "Polygon",
        coordinates: [coordinates]
      };
      
      territories.push({
        name: name,
        folder: folderName,
        flyerCount: flyerCount,
        color: extractColor(styleUrl),
        boundaryGeoJSON: JSON.stringify(geoJSON),
        coordinatesCount: coordinates.length
      });
      
      console.log(`  [OK] ${name} (${coordinates.length} points)`);
    }
  }
  
  console.log(`\n[PARSE] Total: ${territories.length} territories\n`);
  return territories;
}

// ============================================
// SYNC FUNCTION (UPDATE + ADD NEW)
// ============================================

async function syncTerritories(newTerritories, backup) {
  console.log('[SYNC] Syncing territories with Firestore...\n');
  
  const existingTerritories = new Map();
  backup.data.territories.forEach(t => {
    existingTerritories.set(t.name, t);
  });
  
  let updated = 0;
  let added = 0;
  let unchanged = 0;
  
  for (const newTerritory of newTerritories) {
    const existing = existingTerritories.get(newTerritory.name);
    
    if (existing) {
      const updateData = {
        boundaryGeoJSON: newTerritory.boundaryGeoJSON
      };
      
      if (newTerritory.folder && newTerritory.folder !== existing.folder) {
        updateData.folder = newTerritory.folder;
      }
      if (newTerritory.flyerCount !== null && newTerritory.flyerCount !== existing.flyerCount) {
        updateData.flyerCount = newTerritory.flyerCount;
      }
      
      await db.collection('territories').doc(existing.id).update(updateData);
      console.log(`[UPDATE] ${newTerritory.name} (${newTerritory.coordinatesCount} points)`);
      updated++;
    } else {
      // Territory doesn't exist - ADD NEW
      const territoryId = generateId(newTerritory.name);
      
      const territoryData = {
        id: territoryId,
        name: newTerritory.name,
        folder: newTerritory.folder || 'Imported',
        flyerCount: newTerritory.flyerCount,
        assignedTo: null,
        color: newTerritory.color,
        boundaryGeoJSON: newTerritory.boundaryGeoJSON,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await db.collection('territories').doc(territoryId).set(territoryData);
      console.log(`[ADD] ${newTerritory.name} (${newTerritory.coordinatesCount} points)`);
      added++;
    }
  }
  
  console.log(`\n[SYNC] Summary:`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Added: ${added}`);
  console.log(`   Total: ${updated + added}\n`);
  
  return { updated, added, unchanged };
}

// ============================================
// VERIFICATION
// ============================================

async function verifyDatabase() {
  console.log('[VERIFY] Checking database integrity...\n');
  
  const territories = await db.collection('territories').get();
  let valid = 0;
  let invalid = [];
  
  territories.forEach(doc => {
    const data = doc.data();
    try {
      const parsed = JSON.parse(data.boundaryGeoJSON);
      if (parsed.type === 'Polygon' && parsed.coordinates && parsed.coordinates.length > 0) {
        valid++;
      } else {
        invalid.push(data.name);
      }
    } catch (e) {
      invalid.push(data.name);
    }
  });
  
  console.log(`[VERIFY] Valid: ${valid}`);
  console.log(`[VERIFY] Invalid: ${invalid.length}`);
  
  if (invalid.length > 0) {
    console.log(`[WARN] Invalid territories:`);
    invalid.forEach(name => console.log(`   - ${name}`));
  }
  
  console.log();
}

// ============================================
// MAIN FUNCTION
// ============================================

async function main() {
  console.log('===========================================');
  console.log('  PRIZMA TRACKER - TERRITORY SYNC TOOL');
  console.log('===========================================\n');
  
  try {
    // Get KML path from command line or use default
    const kmlPath = process.argv[2] || path.join(__dirname, '../assets/PRIZMA_Distribucija_1.2.kml');
    
    console.log(`[CONFIG] KML File: ${kmlPath}\n`);
    
    // Step 1: Backup
    console.log('[STEP 1/4] Creating backup...');
    const backup = await backupFirestore();
    
    // Step 2: Parse KML
    console.log('[STEP 2/4] Parsing KML...');
    const newTerritories = await parseKML(kmlPath);
    
    // Step 3: Confirm
    console.log('[STEP 3/4] Ready to sync...');
    console.log('[WARN] This will UPDATE existing territories and ADD new ones');
    console.log('[WARN] Worker assignments will NOT be affected\n');
    console.log('Waiting 5 seconds... (Ctrl+C to cancel)\n');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Step 4: Sync
    console.log('[STEP 4/4] Syncing territories...');
    const result = await syncTerritories(newTerritories, backup);
    
    // Step 5: Verify
    await verifyDatabase();
    
    console.log('===========================================');
    console.log('[SUCCESS] Territory sync completed!');
    console.log(`[BACKUP] ${backup.filename}`);
    console.log('===========================================\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n[ERROR] Sync failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// ============================================
// RUN
// ============================================

main();