const axios = require('axios');
const FormData = require('form-data');

/**
 * Professional ImgBB Upload Utility for TUKTUK
 * Handles avatar uploads to ImgBB service
 */
class ImgBBUploader {
  constructor() {
    this.apiKey = process.env.IMGBB_API_KEY;
    this.baseUrl = 'https://api.imgbb.com/1/upload';
    this.maxFileSize = 5 * 1024 * 1024; // 5MB
    this.supportedTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp'
    ];
  }

  /**
   * Check if ImgBB is properly configured
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Validate file before upload
   */
  validateFile(fileBuffer, fileName, mimeType) {
    // Check file size
    if (fileBuffer.length > this.maxFileSize) {
      throw new Error(`File too large. Maximum size: ${this.maxFileSize / 1024 / 1024}MB`);
    }

    // Check file type
    if (!this.supportedTypes.includes(mimeType)) {
      throw new Error(`Unsupported file type: ${mimeType}. Supported types: ${this.supportedTypes.join(', ')}`);
    }

    // Check file name
    if (!fileName || fileName.trim() === '') {
      throw new Error('File name is required');
    }

    return true;
  }

  /**
   * Upload file to ImgBB
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} fileName - File name
   * @param {string} mimeType - MIME type
   * @returns {Object} Upload result
   */
  async uploadFile(fileBuffer, fileName, mimeType) {
    if (!this.isConfigured()) {
      throw new Error('ImgBB is not configured. Please set IMGBB_API_KEY environment variable.');
    }

    try {
      // Validate file
      this.validateFile(fileBuffer, fileName, mimeType);

      console.log(`📤 Uploading avatar to ImgBB: ${fileName} (${(fileBuffer.length / 1024).toFixed(2)}KB)`);

      // Create FormData
      const formData = new FormData();
      formData.append('key', this.apiKey);
      formData.append('image', fileBuffer, {
        filename: fileName,
        contentType: mimeType
      });

      // Upload to ImgBB
      const response = await axios.post(this.baseUrl, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        timeout: 30000 // 30 seconds timeout
      });

      if (response.data.success) {
        const result = response.data.data;
        
        console.log(`✅ Avatar uploaded successfully:`, {
          id: result.id,
          url: result.url,
          size: result.size
        });

        return {
          success: true,
          url: result.url,
          displayUrl: result.display_url,
          deleteUrl: result.delete_url,
          fileName: fileName,
          mimeType: mimeType,
          size: result.size,
          id: result.id,
          timestamp: new Date().toISOString()
        };
      } else {
        throw new Error(`ImgBB API error: ${response.data.error?.message || 'Unknown error'}`);
      }

    } catch (error) {
      console.error('❌ ImgBB upload error:', error);
      
      if (error.response) {
        console.error('ImgBB API Response:', error.response.data);
      }
      
      throw new Error(`ImgBB upload failed: ${error.message}`);
    }
  }

  /**
   * Upload base64 image to ImgBB
   * @param {string} base64Data - Base64 encoded image data
   * @param {string} fileName - File name
   * @returns {Object} Upload result
   */
  async uploadBase64(base64Data, fileName = 'avatar.png') {
    try {
      // Remove data URL prefix if present
      const base64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
      
      // Convert base64 to buffer
      const fileBuffer = Buffer.from(base64, 'base64');
      
      // Determine MIME type from base64 data
      let mimeType = 'image/png';
      if (base64Data.includes('data:image/jpeg')) {
        mimeType = 'image/jpeg';
      } else if (base64Data.includes('data:image/gif')) {
        mimeType = 'image/gif';
      } else if (base64Data.includes('data:image/webp')) {
        mimeType = 'image/webp';
      }

      return await this.uploadFile(fileBuffer, fileName, mimeType);
    } catch (error) {
      console.error('❌ Base64 upload error:', error);
      throw error;
    }
  }

  /**
   * Delete file from ImgBB
   * @param {string} deleteUrl - Delete URL from upload result
   */
  async deleteFile(deleteUrl) {
    if (!deleteUrl) {
      throw new Error('Delete URL is required');
    }

    try {
      console.log(`🗑️ Deleting file from ImgBB: ${deleteUrl}`);
      
      const response = await axios.get(deleteUrl, {
        timeout: 10000
      });
      
      console.log('✅ File deleted from ImgBB:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Error deleting file from ImgBB:', error);
      throw error;
    }
  }

  /**
   * Get upload statistics
   */
  getStats() {
    return {
      configured: this.isConfigured(),
      maxFileSize: this.maxFileSize,
      supportedTypes: this.supportedTypes,
      apiKeyPresent: !!this.apiKey
    };
  }
}

// Create singleton instance
const imgbbUploader = new ImgBBUploader();

module.exports = {
  imgbbUploader,
  ImgBBUploader
};
