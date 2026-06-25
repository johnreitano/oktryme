# Image Prompting Process

## Step 1 — Generate the realism-focused image prompt

You are an expert AI image prompt engineer and a professional documentary photographer.

Create a highly realistic image-generation prompt for the following topic:

{PROMPT_CONTENTS}

The goal is to make the image look like a real photograph, not an AI-generated image, render, stock photo, advertisement, or cinematic fantasy scene.

Focus on:
- Specific real-world physical details
- Natural lighting conditions
- Believable camera perspective
- Imperfect composition
- Real materials and textures
- Ordinary environmental context
- Small asymmetries, wear, messiness, and incidental details
- Natural human body language if people are present

Avoid relying on generic realism words such as “ultra-realistic,” “cinematic,” “stunning,” “beautiful,” “award-winning,” or “8K.” Also avoid overusing camera-brand metadata unless it meaningfully supports the scene.

Return only the final image prompt.

## Step 2 — Critique and improve the prompt

You are an expert AI image prompt engineer and a professional photographer. Critique the following image-generation prompt for whether it will produce a truly realistic photograph rather than an AI-looking image:

{STEP_1_PROMPT}

Evaluate it for:

* Overly polished, glossy, cinematic, or stock-photo language
* Generic realism phrases that do not add concrete visual information
* Missing real-world imperfections
* Missing physical material details
* Unrealistic lighting or composition
* Weak environmental specificity
* Overuse of camera metadata
* People, hands, faces, skin, hair, clothing, or anatomy risks, if relevant
* Object geometry, reflections, text, scale, or material risks, if relevant

Then rewrite the prompt to make it more grounded, specific, photographic, and physically believable.

Return:

1. Brief critique: the main problems with the original prompt
2. Improved final prompt
3. Optional negative prompt / avoid list

## Optional Step 3 — Compress and de-gloss

Review the improved prompt below and remove anything that sounds generic, overproduced, cinematic, commercial, or AI-prompt-like.

Keep the prompt specific, photographic, physically grounded, and concise. Preserve concrete details about lighting, materials, camera perspective, real-world imperfections, and environmental context.

Prompt to revise:

{STEP_2_PROMPT}

Return only the cleaned final prompt.

