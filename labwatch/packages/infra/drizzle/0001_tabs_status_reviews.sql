CREATE TABLE "branch_commits" (
	"repo" text NOT NULL,
	"branch" text NOT NULL,
	"sha" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "branch_commits_repo_branch_sha_pk" PRIMARY KEY("repo","branch","sha")
);
--> statement-breakpoint
CREATE TABLE "check_runs_fetched" (
	"repo" text NOT NULL,
	"head_sha" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"complete" boolean NOT NULL,
	CONSTRAINT "check_runs_fetched_repo_head_sha_pk" PRIMARY KEY("repo","head_sha")
);
--> statement-breakpoint
CREATE TABLE "ci_jobs_fetched" (
	"run_id" bigint PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commit_details" (
	"sha" text PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"file_count" integer NOT NULL,
	"truncated" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commit_files" (
	"sha" text NOT NULL,
	"path" text NOT NULL,
	"status" text,
	CONSTRAINT "commit_files_sha_path_pk" PRIMARY KEY("sha","path")
);
--> statement-breakpoint
CREATE TABLE "pr_comments" (
	"id" bigint PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"author" text,
	"path" text,
	"line" integer,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"html_url" text NOT NULL,
	"in_reply_to_id" bigint
);
--> statement-breakpoint
CREATE TABLE "pr_reviews" (
	"id" bigint PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"author" text,
	"state" text NOT NULL,
	"body" text NOT NULL,
	"submitted_at" timestamp with time zone,
	"html_url" text
);
--> statement-breakpoint
CREATE TABLE "status_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"vantage" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"http_status" integer,
	"latency_ms" integer,
	"tls_ok" boolean,
	"tls_error" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "status_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"vantage" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"failed_checks" integer DEFAULT 1 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "test_reports" (
	"check_run_id" bigint PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"head_sha" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"conclusion" text,
	"html_url" text,
	"completed_at" timestamp with time zone,
	"title" text,
	"parsed" boolean NOT NULL,
	"total" integer NOT NULL,
	"passed" integer NOT NULL,
	"failed" integer NOT NULL,
	"skipped" integer NOT NULL,
	"files" jsonb NOT NULL,
	"annotations" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ci_jobs" ADD COLUMN "steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "review_state" text;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "areas" text[];--> statement-breakpoint
ALTER TABLE "pull_requests" ADD COLUMN "areas_head_sha" text;--> statement-breakpoint
CREATE INDEX "branch_commits_sha_idx" ON "branch_commits" USING btree ("sha");--> statement-breakpoint
CREATE INDEX "commit_files_path_idx" ON "commit_files" USING btree ("path");--> statement-breakpoint
CREATE INDEX "pr_comments_pr_idx" ON "pr_comments" USING btree ("repo","number");--> statement-breakpoint
CREATE INDEX "pr_reviews_pr_idx" ON "pr_reviews" USING btree ("repo","number");--> statement-breakpoint
CREATE INDEX "status_checks_target_idx" ON "status_checks" USING btree ("target","vantage","checked_at");--> statement-breakpoint
CREATE INDEX "status_checks_checked_brin" ON "status_checks" USING brin ("checked_at");--> statement-breakpoint
CREATE INDEX "status_incidents_started_idx" ON "status_incidents" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "status_incidents_open_idx" ON "status_incidents" USING btree ("target","vantage") WHERE "status_incidents"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "test_reports_sha_idx" ON "test_reports" USING btree ("head_sha");