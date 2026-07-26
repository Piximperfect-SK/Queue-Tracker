import mongoose from 'mongoose';

// Admin is intentionally NOT stored here — admin is always full-access and
// isn't editable through this system, to avoid an admin accidentally locking
// themselves out of their own settings page.

export const PAGE_KEYS = ['roster', 'stats', 'logMonitor', 'settings', 'admin'];
export const ACTION_KEYS = [
  'editRoster',
  'editHandlers',
  'deleteLog',
  'exportData',
  'manageUsers',
  'downloadLogs',
  'shiftManagement',
  'importRoster',
  'manageRoles',
  'manage2FA',
  'manageAccessCodes',
  'manageSessions',
];

// Sensible defaults matching roughly how the app currently behaves.
export const DEFAULT_PERMISSIONS = {
  queue_handler: {
    pages: { roster: true, stats: true, logMonitor: true, settings: true, admin: false },
    actions: {
      editRoster: true,
      editHandlers: true,
      deleteLog: false,
      exportData: true,
      manageUsers: false,
      downloadLogs: true,
      shiftManagement: false,
      importRoster: true,
      manageRoles: false,
      manage2FA: false,
      manageAccessCodes: false,
      manageSessions: false,
    },
  },
  associate: {
    pages: { roster: true, stats: true, logMonitor: false, settings: false, admin: false },
    actions: {
      editRoster: false,
      editHandlers: false,
      deleteLog: false,
      exportData: false,
      manageUsers: false,
      downloadLogs: false,
      shiftManagement: false,
      importRoster: false,
      manageRoles: false,
      manage2FA: false,
      manageAccessCodes: false,
      manageSessions: false,
    },
  },
};

const rolePermissionSchema = new mongoose.Schema({
  role: { type: String, enum: ['queue_handler', 'associate'], required: true, unique: true },
  pages: {
    roster: { type: Boolean, default: true },
    stats: { type: Boolean, default: true },
    logMonitor: { type: Boolean, default: false },
    settings: { type: Boolean, default: false },
    admin: { type: Boolean, default: false },
  },
  actions: {
    editRoster: { type: Boolean, default: false },
    editHandlers: { type: Boolean, default: false },
    deleteLog: { type: Boolean, default: false },
    exportData: { type: Boolean, default: false },
    manageUsers: { type: Boolean, default: false },
    downloadLogs: { type: Boolean, default: false },
    shiftManagement: { type: Boolean, default: false },
    importRoster: { type: Boolean, default: false },
    manageRoles: { type: Boolean, default: false },
    manage2FA: { type: Boolean, default: false },
    manageAccessCodes: { type: Boolean, default: false },
    manageSessions: { type: Boolean, default: false },
  },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String },
});

export default mongoose.models.RolePermission || mongoose.model('RolePermission', rolePermissionSchema);
