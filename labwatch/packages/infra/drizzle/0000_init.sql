CREATE TABLE "branches" (
	"repo" text NOT NULL,
	"name" text NOT NULL,
	"head_sha" text NOT NULL,
	"protected" boolean NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "branches_repo_name_pk" PRIMARY KEY("repo","name")
);
--> statement-breakpoint
CREATE TABLE "ci_jobs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"run_id" bigint NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"conclusion" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"html_url" text
);
--> statement-breakpoint
CREATE TABLE "ci_runs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"workflow_name" text NOT NULL,
	"run_number" integer NOT NULL,
	"run_attempt" integer NOT NULL,
	"branch" text,
	"head_sha" text NOT NULL,
	"event" text NOT NULL,
	"status" text NOT NULL,
	"conclusion" text,
	"title" text NOT NULL,
	"actor" text,
	"html_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"run_started_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "commits" (
	"sha" text PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"message" text NOT NULL,
	"author_name" text,
	"author_login" text,
	"committed_at" timestamp with time zone NOT NULL,
	"html_url" text NOT NULL,
	"verified" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"draft" boolean NOT NULL,
	"merged" boolean NOT NULL,
	"author" text,
	"head_ref" text NOT NULL,
	"base_ref" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"html_url" text NOT NULL,
	CONSTRAINT "pull_requests_repo_number_pk" PRIMARY KEY("repo","number")
);
--> statement-breakpoint
CREATE TABLE "source_probes" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL,
	"http_status" integer,
	"latency_ms" integer,
	"body_sha256" text,
	"body_bytes" integer,
	"cert_sha256" text,
	"cert_subject" text,
	"cert_valid_to" timestamp with time zone,
	"tls_error" text,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "ci_jobs_run_idx" ON "ci_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ci_runs_repo_created_idx" ON "ci_runs" USING btree ("repo","created_at");--> statement-breakpoint
CREATE INDEX "commits_repo_committed_idx" ON "commits" USING btree ("repo","committed_at");--> statement-breakpoint
CREATE INDEX "events_at_idx" ON "events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "source_probes_checked_idx" ON "source_probes" USING btree ("checked_at");