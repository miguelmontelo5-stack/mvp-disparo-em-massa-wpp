import { pgTable, text, varchar, integer, timestamp, serial } from 'drizzle-orm/pg-core';

export const campaigns = pgTable('campaigns', {
  id: varchar('id', { length: 64 }).primaryKey(),
  title: text('title').notNull(),
  status: varchar('status', { length: 32 }).notNull().default('pendente'),
  total: integer('total').notNull().default(0),
  enviados: integer('enviados').notNull().default(0),
  falhas: integer('falhas').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export const campaignRecipients = pgTable('campaign_recipients', {
  id: serial('id').primaryKey(),
  campaignId: varchar('campaign_id', { length: 64 }).notNull(),
  number: varchar('number', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('pendente'),
  chip: varchar('chip', { length: 64 }),
  error: text('error'),
  sentAt: timestamp('sent_at'),
});
