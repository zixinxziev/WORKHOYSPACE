Ahoy's Workspace — Full Update
Included changes
Individual task assignment with a dependent Division → Member picker. The backend validates every selected member against the selected active division.
A task is assigned only to the selected member(s); registering or moving a member to a division does not auto-assign old tasks.
Start Time (`datetime-local`) is stored on each task and shown with the deadline in task details and History.
Member submissions support multiple image/PDF/Word/Excel/CSV/PowerPoint files and an optional HTTP(S) URL.
Every submission is stored as a separate version with its own note and attachments. Review decisions are stored separately as immutable submission review records.
Reset History deletes Activity Logs only. Submission versions, attachments, review decisions, tasks, accounts, and task progress are not deleted. Reset Progress also preserves submission and review history.
Existing `proof_files` uploads remain readable in the new submission details.
Create Division, edit Division, member-to-division management, roles, Google Sheets sync, and existing workspace screens are retained.
Deploying an existing installation
Replace the repository contents with this ZIP's contents.
Confirm the Cloudflare Worker bindings/secrets remain configured: D1 binding `DB`, KV binding `PROOFS`, `PASSWORD_PEPPER`, `SETUP_SECRET`, and `GOOGLE_SHEETS_SECRET` (plus the existing `GOOGLE_SHEETS_WEBHOOK` variable).
The provided `migrations/0003_individual_assignments_submissions_start_time.sql` is for the existing database created from the included earlier migrations (`0001_add_target_column.sql` and `0002_divisions.sql`). Run it once after those migrations:
`npm run db:migrate:full-update`
Deploy the Worker: `npm run deploy`.
The existing Worker code already uses `tasks.division_id`; this update preserves that column and includes it in the corrected full `schema.sql`. The migration adds Start Time, creates permanent submission/attachment/review-history tables, and copies existing approval/revision events from Activity Logs into permanent review history before any later Activity History reset. It does not delete existing tasks, assignments, accounts, or old proof files.
Fresh database
For a brand-new D1 database, use `schema.sql` as the initial schema. Do not run the existing-database `0003` migration after initializing from the complete `schema.sql`, because that schema already contains the new columns and tables.
Submission limits
Up to 5 files per submission.
Up to 10 MB per file and 20 MB total per submission.
Supported: JPG/JPEG, PNG, WEBP, PDF, DOC/DOCX, XLS/XLSX, CSV, PPT/PPTX.
Links must use `http://` or `https://`.
