# Backup migration

## Verified legacy backups

| Backup | Schedule | Scope | Retention | Status |
| --- | --- | --- | --- | --- |
| Daily agent backup | 3:00 AM | Encrypted OpenClaw directory archive intended for NAS | 7 local copies | **Failing:** NAS authentication rejected since at least Aug. 13 |
| Weekly database backup | Sunday 4:00 AM | Encrypted PostgreSQL dump intended for NAS | 4 local copies | **Failing:** `pg_dump` is unavailable |

The daily backup excludes package/cache directories, previous backups, and logs. The weekly backup skips safely when its legacy database connection is not configured.

## Immediate legacy recovery

Do not retire, rotate, or replace the legacy backup system until both failures are corrected and a restore test succeeds:

1. Repair the NAS backup account/key authorization without disabling SSH host-key verification.
2. Install/provide the PostgreSQL client required for `pg_dump`.
3. Run controlled backup tests and verify both files reach the NAS.
4. Test restoring a copy into a non-production location.

## v2 decision

Do not copy the legacy NAS scripts into Railway:

- Railway cannot assume access to a private NAS.
- The scripts use local key files and a legacy database environment file.
- The legacy transfer disables SSH host-key checking, which should not be replicated.

## Required v2 backup design

Before OpenClaw retirement:

1. Select a backup target reachable from Railway, or retain a separately secured backup worker.
2. Back up the v2 PostgreSQL database on a defined cadence.
3. Encrypt backups and define key custody.
4. Set retention, owner, monitoring, and failure alerting.
5. Perform and document a restore test into a non-production database.
6. Preserve the legacy backups until the v2 restore test succeeds and leadership approves retirement.

The current legacy backup scripts remain the recovery path for the legacy runtime; they do not protect the new v2 Railway database.
