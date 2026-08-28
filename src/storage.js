'use strict';
/* ============================================================
 * 本地存储：网页版把设置放 B 站 toy 云，抖音版直接用 tt 同步存储
 * ==========================================================*/

function get(key) {
  try {
    if (typeof tt !== 'undefined' && tt.getStorageSync) {
      const value = tt.getStorageSync(key);
      return value === undefined || value === null || value === '' ? null : String(value);
    }
    const value = window.localStorage.getItem(key);
    return value === null ? null : String(value);
  } catch (_) {
    return null;
  }
}

function set(key, value) {
  try {
    if (typeof tt !== 'undefined' && tt.setStorageSync) {
      tt.setStorageSync(key, String(value));
    } else {
      window.localStorage.setItem(key, String(value));
    }
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { get, set };
