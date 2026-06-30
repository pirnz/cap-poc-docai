/**
 * Payload Normalizer - Handle different DocAI callback formats
 */

/**
 * Normalize DocAI webhook payload
 * @param {Object} payload - Raw payload from DocAI webhook
 * @returns {Object} Normalized payload
 */
function normalizePayload(payload) {
  // Handle nested payload structure
  const actualPayload = payload.payload || payload;

  return {
    notificationObjectId: actualPayload.NotificationObjectId || actualPayload.notificationObjectId,
    notificationTargetStatus: actualPayload.NotificationTargetStatus || actualPayload.notificationTargetStatus,
    notificationCreatedAt: actualPayload.NotificationCreatedAt || actualPayload.notificationCreatedAt,
    documentResult: actualPayload.DocumentResult || actualPayload.documentResult
  };
}

/**
 * Validate payload structure
 * @param {Object} payload - Normalized payload
 * @returns {Boolean} Is valid
 */
function validatePayload(payload) {
  if (!payload.notificationObjectId) {
    console.error('Missing NotificationObjectId in payload');
    return false;
  }

  if (!payload.documentResult) {
    console.error('Missing DocumentResult in payload');
    return false;
  }

  if (!payload.documentResult.documentVersions || !Array.isArray(payload.documentResult.documentVersions)) {
    console.error('Missing or invalid documentVersions in DocumentResult');
    return false;
  }

  return true;
}

module.exports = {
  normalizePayload,
  validatePayload
};
