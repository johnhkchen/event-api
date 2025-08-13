CREATE TABLE "event_companies" (
	"event_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"relationship_type" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT "companies_name_unique";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "domain" text;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD COLUMN "extraction_confidence" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "speakers" ADD COLUMN "normalized_name" text;--> statement-breakpoint
ALTER TABLE "speakers" ADD COLUMN "confidence_score" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "event_companies" ADD CONSTRAINT "event_companies_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_companies" ADD CONSTRAINT "event_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_normalized_name_unique" UNIQUE("normalized_name");