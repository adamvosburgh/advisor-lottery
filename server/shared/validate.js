const { z } = require('zod');

const AdvisorSchema = z
  .object({
    name: z.string().min(1, 'Advisor name is required'),
    capacity: z.coerce.number().int().min(0, 'Capacity must be zero or a positive integer'),
    minCapacity: z.coerce.number().int().min(0).optional(),
    notes: z.string().optional().nullable()
  })
  .transform((advisor) => ({
    name: advisor.name.trim(),
    capacity: advisor.capacity,
    ...(advisor.minCapacity !== undefined ? { minCapacity: advisor.minCapacity } : {}),
    notes: advisor.notes ? advisor.notes.trim() || undefined : undefined
  }));

const StudentSchema = z
  .object({
    name: z.string().min(1, 'Student name is required'),
    preferences: z
      .array(z.string().transform((pref) => pref.trim()).pipe(z.string().min(1)))
      .optional()
  })
  .transform((student) => ({
    name: student.name.trim(),
    preferences: (student.preferences || []).filter(Boolean)
  }));

const RequestSchema = z.object({
  mode: z.enum(['advisor', 'studio']).optional().default('advisor'),
  advisors: z.array(AdvisorSchema).min(1, 'At least one advisor is required'),
  students: z.array(StudentSchema).min(1, 'At least one student is required'),
  parameters: z.string().optional().transform((value) => (value ? value.trim() : '')),
  lotteryName: z.string().min(1, 'Lottery name is required').transform((value) => value.trim())
});

function validateRequestPayload(payload) {
  return RequestSchema.parse(payload);
}

module.exports = {
  validateRequestPayload
};
