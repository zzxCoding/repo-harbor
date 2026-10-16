#!/usr/bin/env node
const prompt = process.argv[2] || '';
process.stdout.write(/username/i.test(prompt) ? (process.env.ATLAS_GIT_USERNAME || 'oauth2') : (process.env.ATLAS_GIT_TOKEN || ''));
process.stdout.write('\n');
