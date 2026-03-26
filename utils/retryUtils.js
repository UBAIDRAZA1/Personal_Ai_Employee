const fs = require('fs');
const path = require('path');

function getBackoffDelay(baseDelayMs, attempt) {
  if (attempt === 1) return 0;
  if (attempt === 2) return baseDelayMs;
  if (attempt === 3) return baseDelayMs * 3;
  if (attempt === 4) return baseDelayMs * 9;
  return baseDelayMs * Math.pow(3, attempt - 1);
}

async function retryAsyncOperation(operation, maxAttempts, baseDelayMs, onRetry) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const delay = getBackoffDelay(baseDelayMs, attempt);
    if (delay > 0) {
      if (onRetry) {
        onRetry(attempt, delay, lastError);
      } else {
        console.log(`[Retry] Waiting ${delay}ms before attempt ${attempt}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      const result = await operation();
      return result;
    } catch (error) {
      lastError = error;
      console.error(`[Retry] Attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxAttempts) {
        throw error;
      }
    }
  }
  if (lastError) {
    throw lastError;
  }
}

module.exports = {
  retryAsyncOperation,
};

