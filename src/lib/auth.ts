import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: (process.env.DB_PROVIDER as "sqlite" | "postgresql" | undefined) ?? "sqlite",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },
  session: {
    expiresIn: 60 * 60 * 12, // 12 hours — one working day
    updateAge: 60 * 60, // refresh if older than 1h
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "cashier", required: false },
      nameMy: { type: "string", required: false },
      pinHash: { type: "string", required: false },
      phone: { type: "string", required: false },
      branchId: { type: "string", required: false },
      active: { type: "boolean", defaultValue: true, required: false },
    },
  },
  trustedOrigins: [process.env.APP_URL ?? "http://localhost:3000"],
});

export type Auth = typeof auth;
