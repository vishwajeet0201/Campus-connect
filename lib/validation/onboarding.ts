import { z } from "zod";

export const onboardingSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name."),
  username: z.string().trim().regex(/^[a-z0-9_]{3,24}$/, "Use 3-24 lowercase letters, numbers, or underscores."),
  departmentId: z.string().uuid("Choose a department."),
  degree: z.enum(["diploma", "btech", "mtech"]),
  year: z.coerce.number().int().min(1).max(4),
  rollNumber: z.string().trim().max(40).optional().or(z.literal("")),
  bio: z.string().trim().max(160, "Keep your bio under 160 characters.").optional().or(z.literal("")),
  avatarUrl: z.string().url().optional().or(z.literal("")),
}).superRefine((value, context) => {
  const maxYear = value.degree === "diploma" ? 3 : value.degree === "btech" ? 4 : 2;
  if (value.year > maxYear) context.addIssue({ code: "custom", path: ["year"], message: `Choose a year from 1 to ${maxYear}.` });
});

export type OnboardingValues = z.infer<typeof onboardingSchema>;