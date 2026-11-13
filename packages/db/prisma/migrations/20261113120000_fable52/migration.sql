-- Opt-in only; preserve existing defaults, pins and operator changes.
INSERT INTO "available_models"
 ("id","modelId","displayName","provider","category","inputPrice","outputPrice","isActive","isPlatformDefault","sortOrder","createdAt","updatedAt")
VALUES ('seed_claude_fable_5_2','claude-fable-5-2','Claude Fable 5.2','anthropic','llm',8,40,true,false,-5,now(),now())
ON CONFLICT ("modelId") DO NOTHING;
