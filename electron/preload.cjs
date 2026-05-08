const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  listWorkouts: () => ipcRenderer.invoke('list-workouts'),
  loadWorkout: (fileName) => ipcRenderer.invoke('load-workout', fileName),
  
  checkGarminAuth: () => ipcRenderer.invoke('check-garmin-auth'),
  connectGarmin: (email, password) => ipcRenderer.invoke('connect-garmin', email, password),
  logoutGarmin: () => ipcRenderer.invoke('logout-garmin'),
  syncGarmin: () => ipcRenderer.invoke('sync-garmin'),

  uploadCareLinkCSV: () => ipcRenderer.invoke('upload-carelink-csv'),

  loadComments: (workoutId) => ipcRenderer.invoke('load-comments', workoutId),
  saveComment: (workoutId, comment) => ipcRenderer.invoke('save-comment', workoutId, comment),
  deleteComment: (workoutId, commentId) => ipcRenderer.invoke('delete-comment', workoutId, commentId),
  loadTags: () => ipcRenderer.invoke('load-tags'),
  saveTag: (tag) => ipcRenderer.invoke('save-tag', tag),
  deleteTag: (tagId) => ipcRenderer.invoke('delete-tag', tagId),
});
