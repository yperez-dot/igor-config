export async function cleanupMalformedLeadReminders(store) {
  if (!store?.cancelMalformedLeadReminders) return { cancelled: 0 };
  return store.cancelMalformedLeadReminders();
}
