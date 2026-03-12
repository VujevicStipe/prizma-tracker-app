const admin = require('firebase-admin');
const fs = require('fs');
const xml2js = require('xml2js');
const path = require('path');

const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

function generateId(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 50);
}

function extractCoordinates(coordinatesString) {
  if (!coordinatesString) return [];
  
  const coordsArray = coordinatesString
    .trim()
    .split(/\s+/)
    .map(coord => {
      const [lng, lat] = coord.split(',');
      return [parseFloat(lng), parseFloat(lat)];
    })
    .filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
  
  return coordsArray;
}

function extractColor(styleUrl) {
  if (!styleUrl) return '#000000';
  
  const colorMatch = styleUrl.match(/poly-([A-F0-9]{6})-/i);
  if (colorMatch) {
    return `#${colorMatch[1]}`;
  }
  return '#000000';
}

async function importTerritories() {
  console.log('🚀 Starting territory import...\n');

  try {
    const kmlPath = path.join(__dirname, '../assets/tereni.kml');
    const kmlData = fs.readFileSync(kmlPath, 'utf-8');
    
    console.log('KML file loaded\n');

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(kmlData);
    
    const document = result.kml.Document[0];
    const folders = document.Folder || [];
    
    console.log(`Found ${folders.length} folders\n`);

    let totalTerritories = 0;
    const batch = db.batch();

    for (const folder of folders) {
      const folderName = folder.name[0];
      const placemarks = folder.Placemark || [];
      
      console.log(`Processing folder: ${folderName} (${placemarks.length} territories)`);

      for (const placemark of placemarks) {
        const name = placemark.name[0].trim();
        const description = placemark.description ? placemark.description[0] : null;
        const styleUrl = placemark.styleUrl ? placemark.styleUrl[0] : null;
        
        let coordinates = [];
        if (placemark.Polygon) {
          const coordString = placemark.Polygon[0].outerBoundaryIs[0]
            .LinearRing[0].coordinates[0];
          coordinates = extractCoordinates(coordString);
        } else if (placemark.MultiGeometry) {
          const polygons = placemark.MultiGeometry[0].Polygon || [];
          if (polygons.length > 0) {
            const coordString = polygons[0].outerBoundaryIs[0]
              .LinearRing[0].coordinates[0];
            coordinates = extractCoordinates(coordString);
          }
        }

        if (coordinates.length === 0) {
          console.log(`⚠️  Skipping ${name} - no coordinates found`);
          continue;
        }

        const territoryId = generateId(name);
        
        let flyerCount = null;
        if (description) {
          const match = description.match(/(\d+)\s*kom/i);
          if (match) {
            flyerCount = parseInt(match[1]);
          }
        }

        const boundaryGeoJSON = JSON.stringify({
          type: 'Polygon',
          coordinates: [coordinates] 
        });

        const territoryData = {
          id: territoryId,
          name: name,
          folder: folderName,
          flyerCount: flyerCount,
          assignedTo: null,
          color: extractColor(styleUrl),
          boundaryGeoJSON: boundaryGeoJSON, // ⭐ Stored as string
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = db.collection('territories').doc(territoryId);
        batch.set(docRef, territoryData);
        
        totalTerritories++;
        console.log(`  ✅ ${name} (${coordinates.length} points)`);
      }
    }

    console.log(`\n💾 Uploading ${totalTerritories} territories to Firestore...`);
    await batch.commit();
    console.log('✅ All territories uploaded successfully!\n');

  } catch (error) {
    console.error('❌ Error importing territories:', error);
    process.exit(1);
  }
}

async function createTestWorkers() {
  console.log('👷 Creating test workers...\n');

  const workers = [
    { id: 'radnik-001', name: 'Marko Marković', pin: '1234' },
    { id: 'radnik-002', name: 'Ivana Horvat', pin: '2345' },
    { id: 'radnik-003', name: 'Petar Kovač', pin: '3456' },
    { id: 'radnik-004', name: 'Ana Jurić', pin: '4567' },
    { id: 'radnik-005', name: 'Tomislav Babić', pin: '5678' }
  ];

  const batch = db.batch();

  for (const worker of workers) {
    const docRef = db.collection('workers').doc(worker.id);
    batch.set(docRef, {
      ...worker,
      active: true,
      assignedTerritories: [], 
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`  ✅ ${worker.name} (PIN: ${worker.pin})`);
  }

  await batch.commit();
  console.log('\n✅ Test workers created!\n');
}

async function run() {
  try {
    await importTerritories();
    await createTestWorkers();
    
    console.log(' Import completed successfully!');
    console.log('\n📊 Summary:');
    console.log('   - Territories imported from KML');
    console.log('   - 5 test workers created');
    console.log('   - Ready for GPS tracking!\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

run();