import { z } from 'zod';
export const pageReviewSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    content: z.string().min(1).max(20000),
    spaceId: z.string().min(1),
    // Set both to update an existing page instead of creating a new one. The
    // revision comes from read_space_page, so a page edited after the draft
    // fails the usual revision check rather than being overwritten. Strict
    // function-tool schemas send unused fields as null, which means absent.
    pageId: z.string().min(1).nullable().optional(),
    expectedRevision: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type PageReviewDraft = z.infer<typeof pageReviewSchema>;
export const pageReviewTool = {
  name: 'review_space_page',
  description:
    'Present a Markdown draft for human review before saving it into an authorized Space. The user can approve and save, or decline. To revise an existing page, pass its pageId and the expectedRevision from read_space_page; otherwise a new page is created. Do not create or edit the page yourself after this tool: its approved result includes the saved page URL. Call once, then wait for the review result.',
  parameters: z.toJSONSchema(pageReviewSchema),
};
