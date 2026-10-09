// services/userinfo.js — 头像与昵称（V1.1）
// 头像：<button open-type="chooseAvatar"> 给的是临时文件，重启即失效，
//       所以用 FileSystemManager.saveFile 落到 wx.env.USER_DATA_PATH（用户本地目录，不占代码包）。
// 昵称：优先写云档案 profiles（有档案时），同时本地留一份，
//       这样没建档也能改昵称（不会被 onboarding 流程卡住）。
const AVATAR_KEY = 'avatar_path_v1';
const NICKNAME_KEY = 'nickname_v1';
const MAX_NICK_LEN = 16;

let _mem = {};
function storage() {
  if (typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function') {
    return {
      get: (k) => wx.getStorageSync(k),
      set: (k, v) => wx.setStorageSync(k, v),
      remove: (k) => wx.removeStorageSync(k)
    };
  }
  return {
    get: (k) => _mem[k],
    set: (k, v) => { _mem[k] = v; },
    remove: (k) => { delete _mem[k]; }
  };
}

// 昵称清洗：去首尾空格、压掉换行、限长
function normalizeNickname(name) {
  return String(name === undefined || name === null ? '' : name)
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .slice(0, MAX_NICK_LEN);
}

function getAvatar() {
  try {
    const p = storage().get(AVATAR_KEY);
    return typeof p === 'string' ? p : '';
  } catch (e) {
    return '';
  }
}

function getNickname() {
  try {
    return normalizeNickname(storage().get(NICKNAME_KEY));
  } catch (e) {
    return '';
  }
}

// 保存头像：tempFilePath → 本地用户目录，返回可长期使用的路径
function saveAvatar(tempFilePath) {
  return new Promise((resolve, reject) => {
    if (!tempFilePath || typeof tempFilePath !== 'string') {
      reject(new Error('头像地址为空'));
      return;
    }
    // 已经是持久化目录里的文件（比如再次选择同一个）直接用
    if (typeof wx !== 'undefined' && wx.env && tempFilePath.indexOf(wx.env.USER_DATA_PATH) === 0) {
      _writeAvatarPath(tempFilePath);
      resolve(tempFilePath);
      return;
    }
    try {
      const fs = wx.getFileSystemManager();
      const target = `${wx.env.USER_DATA_PATH}/avatar-${Date.now()}.png`;
      fs.saveFile({
        tempFilePath,
        filePath: target,
        success: (res) => {
          const saved = (res && res.savedFilePath) || target;
          _writeAvatarPath(saved);
          resolve(saved);
        },
        fail: (err) => reject(err)
      });
    } catch (err) {
      reject(err);
    }
  });
}

function _writeAvatarPath(path) {
  try {
    storage().set(AVATAR_KEY, path);
  } catch (e) {
    console.warn('头像路径写入失败：', e);
  }
}

function setNickname(name) {
  const safe = normalizeNickname(name);
  try {
    storage().set(NICKNAME_KEY, safe);
  } catch (e) {
    console.warn('昵称写入失败：', e);
  }
  return safe;
}

// 昵称同步到云档案（没建档 / 未登录 / 云端失败都只是跳过，不影响本地显示）
async function syncNicknameToCloud(name) {
  const safe = normalizeNickname(name);
  try {
    const app = getApp();
    const profile = app && app.globalData && app.globalData.profile;
    if (!profile || !profile._id || !safe) return false;
    const db = wx.cloud.database();
    await db.collection('profiles').doc(profile._id).update({
      data: { nickname: safe, updatedAt: db.serverDate() }
    });
    profile.nickname = safe; // 本地 globalData 一起更新，避免页面显示回退
    return true;
  } catch (err) {
    console.warn('昵称同步到云档案失败（不影响本地显示）：', err && (err.errMsg || err.message));
    return false;
  }
}

// 展示用昵称：本地设置 > 云档案 > 默认
function displayName(profile, fallback) {
  return getNickname() || (profile && profile.nickname) || fallback || '未命名健身搭子';
}

function clear() {
  try {
    storage().remove(AVATAR_KEY);
    storage().remove(NICKNAME_KEY);
  } catch (e) {
    console.warn('清空头像昵称失败：', e);
  }
}

module.exports = {
  AVATAR_KEY,
  NICKNAME_KEY,
  MAX_NICK_LEN,
  getAvatar,
  getNickname,
  saveAvatar,
  setNickname,
  syncNicknameToCloud,
  displayName,
  clear,
  _internal: { normalizeNickname }
};
