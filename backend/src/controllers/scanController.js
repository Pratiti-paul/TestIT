import { scanWebsite, ScannerError } from '../services/scanService.js';

/**
 * Handles website preview scan requests:
 * POST /api/scans/preview
 */
export const previewScan = async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({
        success: false,
        message: 'A valid "url" string is required in the request body',
        code: 'MISSING_URL',
      });
    }

    const scanResult = await scanWebsite(url.trim());

    return res.status(200).json({
      success: true,
      data: scanResult,
    });
  } catch (error) {
    if (error instanceof ScannerError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        code: error.code,
      });
    }

    // Never leak stack traces or internal implementation details
    console.error('Unhandled scan controller error:', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while processing the website scan',
      code: 'INTERNAL_SCAN_ERROR',
    });
  }
};

