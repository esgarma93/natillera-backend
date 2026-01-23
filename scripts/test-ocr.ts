/**
 * Test script for Google Cloud Vision OCR
 * 
 * Usage:
 * 1. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_CLOUD_CREDENTIALS env var
 * 2. Run: npx ts-node scripts/test-ocr.ts [image-url-or-path]
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ImageAnnotatorClient } from '@google-cloud/vision';
import * as fs from 'fs';
import * as path from 'path';

async function testOcr() {
  console.log('🔍 Testing Google Cloud Vision OCR Setup\n');

  // Check credentials
  const credentialsJson = process.env.GOOGLE_CLOUD_CREDENTIALS;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!credentialsJson && !credentialsPath) {
    console.error('❌ No credentials found!');
    console.log('\nPlease set one of these environment variables:');
    console.log('  - GOOGLE_CLOUD_CREDENTIALS (JSON string)');
    console.log('  - GOOGLE_APPLICATION_CREDENTIALS (path to JSON file)');
    process.exit(1);
  }

  console.log('✅ Credentials found:', credentialsJson ? 'JSON string' : `File: ${credentialsPath}`);

  // Initialize client
  let client: ImageAnnotatorClient;
  try {
    if (credentialsJson) {
      const credentials = JSON.parse(credentialsJson);
      client = new ImageAnnotatorClient({
        credentials,
        projectId: credentials.project_id,
      });
      console.log(`✅ Project ID: ${credentials.project_id}`);
    } else {
      client = new ImageAnnotatorClient({
        keyFilename: credentialsPath,
      });
    }
    console.log('✅ Vision client initialized successfully\n');
  } catch (error: any) {
    console.error('❌ Failed to initialize Vision client:', error.message);
    process.exit(1);
  }

  // Test with a sample image
  const testImageUrl = process.argv[2];
  
  if (testImageUrl) {
    console.log(`📸 Testing OCR with: ${testImageUrl}\n`);
    
    try {
      let result;
      
      if (testImageUrl.startsWith('http')) {
        // URL-based image
        [result] = await client.textDetection(testImageUrl);
      } else {
        // Local file
        const imagePath = path.resolve(testImageUrl);
        if (!fs.existsSync(imagePath)) {
          console.error(`❌ File not found: ${imagePath}`);
          process.exit(1);
        }
        const imageContent = fs.readFileSync(imagePath);
        [result] = await client.textDetection({ image: { content: imageContent } });
      }

      const detections = result.textAnnotations;
      
      if (detections && detections.length > 0) {
        console.log('✅ OCR successful!\n');
        console.log('📝 Detected text:');
        console.log('─'.repeat(50));
        console.log(detections[0].description);
        console.log('─'.repeat(50));
        
        // Try to extract amounts
        const text = detections[0].description || '';
        const amounts = extractAmounts(text);
        
        if (amounts.length > 0) {
          console.log('\n💰 Detected amounts:');
          amounts.forEach((amount, i) => {
            console.log(`   ${i + 1}. $${amount.toLocaleString('es-CO')}`);
          });
        } else {
          console.log('\n⚠️ No currency amounts detected');
        }
      } else {
        console.log('⚠️ No text detected in image');
      }
    } catch (error: any) {
      console.error('❌ OCR failed:', error.message);
      if (error.code === 7) {
        console.log('\n💡 This error usually means the Cloud Vision API is not enabled.');
        console.log('   Go to: https://console.cloud.google.com/apis/library/vision.googleapis.com');
      }
    }
  } else {
    // Just test the connection
    console.log('📡 Testing API connection...');
    try {
      // Make a simple request with a tiny test image (1x1 white pixel)
      const testPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      await client.textDetection({ image: { content: testPixel } });
      console.log('✅ API connection successful!\n');
      console.log('🎉 Google Cloud Vision is ready to use!\n');
      console.log('To test with an image, run:');
      console.log('  npx ts-node scripts/test-ocr.ts <image-url-or-path>');
    } catch (error: any) {
      if (error.message.includes('Could not find')) {
        console.log('✅ API connection successful! (no text in test image, which is expected)\n');
        console.log('🎉 Google Cloud Vision is ready to use!');
      } else {
        console.error('❌ API test failed:', error.message);
        if (error.code === 7) {
          console.log('\n💡 Enable the Vision API at:');
          console.log('   https://console.cloud.google.com/apis/library/vision.googleapis.com');
        } else if (error.code === 16) {
          console.log('\n💡 Authentication failed. Check your credentials.');
        }
      }
    }
  }
}

function extractAmounts(text: string): number[] {
  const amounts: number[] = [];
  const patterns = [
    /\$\s*([\d]{1,3}(?:\.[\d]{3})+)(?:[,.][\d]{2})?/g,
    /\$\s*([\d]{1,3}(?:,[\d]{3})+)(?:\.[\d]{2})?/g,
    /(?<!\d)([\d]{1,3}(?:[.,][\d]{3})+)(?:[,.][\d]{2})?(?!\d)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const cleaned = match[1].replace(/[.,]/g, '');
      const amount = parseInt(cleaned, 10);
      if (amount >= 1000 && amount <= 100000000 && !amounts.includes(amount)) {
        amounts.push(amount);
      }
    }
  }

  return amounts.sort((a, b) => b - a);
}

testOcr().catch(console.error);
