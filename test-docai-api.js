/**
 * DocAI API Investigation Script
 * Fetches document and inspects entity structure
 */

const axios = require('axios');

const CONFIG = {
  clientId: 'sb-0a5ee92c-cc64-4f8c-be82-bd2b51aa45d5!b650759|na-f20548c0-157d-417b-8bbb-1c9f35ecfb2d!b20821',
  clientSecret: '75060241-0bb6-4828-9762-c7f0e609f95c$vNIFuhF6ZugTE8cGuSEQlMRilrDFJLAFpFYHTd1L-aU=',
  tokenUrl: 'https://docai-workshop.authentication.eu10.hana.ondemand.com/oauth/token',
  apiEndpoint: 'https://eu10.doc.cloud.sap/document-ai/v1/',
  documentId: 'eb9831ed-c949-44c5-a526-61133625136a'
};

async function getAccessToken() {
  console.log('🔑 Getting access token...');

  const response = await axios.post(
    CONFIG.tokenUrl,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  console.log('✅ Token obtained\n');
  return response.data.access_token;
}

async function fetchDocument(token, documentId) {
  console.log(`📄 Fetching document: ${documentId}`);

  const url = `${CONFIG.apiEndpoint}DocumentService/Documents(${documentId})`;
  console.log(`🔗 URL: ${url}\n`);

  const response = await axios.get(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  return response.data;
}

async function listAllDocumentEntities(token, limit = 50) {
  console.log(`📋 Listing DocumentEntities (limit ${limit})...`);

  const url = `${CONFIG.apiEndpoint}DocumentService/DocumentEntities?$top=${limit}`;
  console.log(`🔗 URL: ${url}\n`);

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    return response.data.value || response.data.d?.results || [];
  } catch (error) {
    console.log('⚠️  Could not fetch entities:', error.response?.data?.error?.message);
    return [];
  }
}

async function getDocumentMetadata(token, documentId) {
  console.log(`📋 Getting document metadata via $metadata...`);

  const url = `${CONFIG.apiEndpoint}DocumentService/$metadata`;
  console.log(`🔗 URL: ${url}\n`);

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/xml'
      }
    });
    return response.data;
  } catch (error) {
    console.log('⚠️  Could not fetch metadata:', error.response?.data?.error?.message);
    return null;
  }
}

async function getSchemaEntitiesFromSchemaService(token, schemaVersionId) {
  console.log(`\n📐 Querying SchemaService for schema entities...`);
  console.log(`   schemaVersion_ID: ${schemaVersionId}`);

  const url = `${CONFIG.apiEndpoint}SchemaService/SchemaEntities?$filter=schemaVersion_ID eq ${schemaVersionId}`;
  console.log(`🔗 ${url}\n`);

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const entities = response.data.value || [];
    console.log(`✅ Found ${entities.length} schema entities`);

    if (entities.length > 0) {
      console.log('\n📋 Schema Entity Structure (first entity):');
      console.log(JSON.stringify(entities[0], null, 2));
      console.log('\n📋 All Schema Entity Names:');
      entities.forEach((e, idx) => {
        console.log(`  ${idx + 1}. name: "${e.name}", label: "${e.label || ''}", type: "${e.type || ''}"`);
      });

      // Look for supplierID
      const supplierIDEntity = entities.find(e =>
        e.name === 'supplierID' ||
        e.name === 'supplierId' ||
        e.name === 'supplier_id' ||
        e.label === 'Supplier ID' ||
        e.label === 'SupplierID' ||
        e.name?.toLowerCase() === 'supplierid'
      );

      if (supplierIDEntity) {
        console.log('\n🎯 FOUND SUPPLIER ID FIELD IN SCHEMA:');
        console.log(JSON.stringify(supplierIDEntity, null, 2));
      } else {
        console.log('\n⚠️  SUPPLIER ID FIELD NOT FOUND IN SCHEMA');
        console.log('   The schema does not include a supplierID field.');
      }
    }

    return response.data;
  } catch (error) {
    console.log(`⚠️  SchemaService query failed: ${error.response?.status} ${error.response?.data?.error?.message || error.message}`);
    return null;
  }
}

async function getFullMetadata(token) {
  console.log(`📋 Fetching full $metadata...`);

  const url = `${CONFIG.apiEndpoint}DocumentService/$metadata`;

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/xml'
      }
    });

    // Extract navigation properties for Documents entity
    const docEntityMatch = response.data.match(/<EntityType Name="Documents"[^>]*>([\s\S]*?)<\/EntityType>/);
    if (docEntityMatch) {
      console.log('📄 Documents EntityType definition:');
      console.log(docEntityMatch[0].substring(0, 3000));
      console.log('\n...\n');

      const navProps = docEntityMatch[0].match(/<NavigationProperty Name="([^"]+)"/g);
      if (navProps) {
        console.log('\n🔍 Available NavigationProperties on Documents:');
        navProps.forEach(np => console.log(`  ${np}`));
        console.log();
      }
    }

    return response.data;
  } catch (error) {
    console.log('⚠️  Metadata failed:', error.message);
    return null;
  }
}

async function tryValidExpansions(token, documentId) {
  console.log(`🔍 Trying metadata-discovered navigation properties...`);

  // From the metadata snippet seen earlier, these were valid:
  const validExpansions = ['workflowExecutions', 'file', 'systemInformation', 'schemaVersion', 'documentType'];

  for (const expand of validExpansions) {
    const url = `${CONFIG.apiEndpoint}DocumentService/Documents(${documentId})?$expand=${expand}`;
    console.log(`\nTrying expand=${expand}`);

    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      console.log(`✅ SUCCESS with expand=${expand}`);
      console.log(JSON.stringify(response.data[expand], null, 2));
    } catch (error) {
      console.log(`  ❌ ${error.response?.status} ${error.response?.data?.error?.message || error.message}`);
    }
  }
}

async function testUpdateSupplierID(token, documentId) {
  console.log('\n\n=== TESTING SUPPLIER ID UPDATE ===\n');

  // Step 1: Fetch document with expanded versions and entities
  console.log('📄 Step 1: Fetching document with expanded entities...');
  const fetchUrl = `${CONFIG.apiEndpoint}DocumentService/Documents(${documentId})?$expand=versions($expand=entities)`;
  console.log(`🔗 ${fetchUrl}\n`);

  const docResponse = await axios.get(fetchUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  console.log(`✅ Document fetched`);
  console.log(`   - clientId: ${docResponse.data.clientId}`);
  console.log(`   - schemaVersion_ID: ${docResponse.data.schemaVersion_ID}`);
  console.log(`   - schemaName: ${docResponse.data.schemaName}`);
  console.log(`   - status: ${docResponse.data.status}`);

  // Step 2: Find latest version and entities
  const docVersions = docResponse.data.versions || [];
  if (docVersions.length === 0) {
    throw new Error('No versions found in document');
  }

  const latestDocVersion = docVersions.reduce((prev, current) =>
    (current.version > prev.version) ? current : prev
  );

  console.log(`\n📦 Latest version: ${latestDocVersion.version}`);

  const allEntities = latestDocVersion.entities || [];
  console.log(`   Total entities: ${allEntities.length}`);

  // Log ALL entities (not just header fields)
  console.log('\n📋 ALL entities:');
  allEntities.forEach((e, idx) => {
    console.log(`   ${idx + 1}. name: "${e.name}", type: "${e.type}", parent_ID: "${e.parent_ID || 'none'}", value: "${e.stringValue || e.numberValue || '(empty)'}"`);
  });

  // Step 3: Find supplierID entity
  console.log('\n🔍 Step 2: Looking for supplierID entity...');
  let supplierIDEntity = allEntities.find(e =>
    e.name === 'supplierID' ||
    e.name === 'supplierId' ||
    e.name === 'supplier_id' ||
    e.label === 'Supplier ID' ||
    e.label === 'SupplierID' ||
    e.name?.toLowerCase() === 'supplierid'
  );

  if (!supplierIDEntity) {
    console.log('⚠️  supplierID entity not found in document - attempting to create it...');

    // Find the supplier group parent
    const supplierGroup = allEntities.find(e =>
      e.name === 'supplier' || e.name === 'supplierInformation'
    );

    if (!supplierGroup) {
      console.error('❌ Cannot find supplier group to attach supplierID field');
      throw new Error('supplier group not found');
    }

    console.log(`   Found parent group: ${supplierGroup.name} (ID: ${supplierGroup.ID})`);

    // Get schema entity ID for supplierID
    const schemaEntitiesUrl = `${CONFIG.apiEndpoint}SchemaService/SchemaEntities?$filter=schemaVersion_ID eq ${docResponse.data.schemaVersion_ID} and name eq 'supplierID'`;
    const schemaEntityResp = await axios.get(schemaEntitiesUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const supplierIDSchemaEntity = schemaEntityResp.data.value?.[0];
    if (!supplierIDSchemaEntity) {
      throw new Error('supplierID not found in schema');
    }

    console.log(`   Schema entity ID: ${supplierIDSchemaEntity.ID}`);

    // Attempt to create the entity
    console.log('\n✏️  Attempting to create supplierID entity...');
    const createUrl = `${CONFIG.apiEndpoint}DocumentService/DocumentEntities`;
    console.log(`🔗 ${createUrl}\n`);

    try {
      const createResponse = await axios.post(createUrl, {
        name: 'supplierID',
        type: 'Field',
        dataType: 'String',
        stringValue: '',
        schemaEntity_ID: supplierIDSchemaEntity.ID,
        parent_ID: supplierGroup.ID,
        documentVersion_ID: latestDocVersion.ID
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('✅ Entity created:', createResponse.data);

      // Use the newly created entity
      supplierIDEntity = createResponse.data;

    } catch (createError) {
      console.error('❌ Failed to create entity:', createError.response?.data || createError.message);
      throw new Error('Cannot create supplierID entity: ' + (createError.response?.data?.error?.message || createError.message));
    }
  } else {
    console.log(`✅ Found supplierID entity:`);
    console.log(`   - ID: ${supplierIDEntity.ID}`);
    console.log(`   - name: ${supplierIDEntity.name}`);
    console.log(`   - label: ${supplierIDEntity.label}`);
    console.log(`   - current value: "${supplierIDEntity.stringValue || '(empty)'}"`);
  }
  const testSupplierID = 'SUP-TEST-999';
  console.log(`\n✏️  Step 3: Updating supplierID to: ${testSupplierID}`);

  const updateUrl = `${CONFIG.apiEndpoint}DocumentService/DocumentEntities(${supplierIDEntity.ID})`;
  console.log(`🔗 ${updateUrl}\n`);

  await axios.patch(updateUrl, {
    stringValue: testSupplierID
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  });

  console.log('✅ Update request sent successfully');

  // Step 5: Verify the update
  console.log('\n🔍 Step 4: Verifying update...');

  const verifyResponse = await axios.get(fetchUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  const verifyVersions = verifyResponse.data.versions || [];
  const verifyLatest = verifyVersions.reduce((prev, current) =>
    (current.version > prev.version) ? current : prev
  );

  const verifyEntities = verifyLatest.entities || [];
  const verifiedSupplierID = verifyEntities.find(e => e.ID === supplierIDEntity.ID);

  if (verifiedSupplierID && verifiedSupplierID.stringValue === testSupplierID) {
    console.log(`✅ SUCCESS! supplierID updated to: "${verifiedSupplierID.stringValue}"`);
  } else {
    console.log(`⚠️  Verification: "${verifiedSupplierID?.stringValue || '(empty)'}"`);
  }

  console.log('\n=== TEST COMPLETE ===\n');
}

async function main() {
  try {
    const token = await getAccessToken();

    // Fetch basic document info
    const document = await fetchDocument(token, CONFIG.documentId);
    console.log('📄 Document Details:');
    console.log(JSON.stringify(document, null, 2));
    console.log();

    const schemaVersionId = document.schemaVersion_ID;

    // Query SchemaService to verify supplierID field exists in schema
    await getSchemaEntitiesFromSchemaService(token, schemaVersionId);

    // Test updating the supplierID field
    await testUpdateSupplierID(token, CONFIG.documentId);

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Full response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

main();
