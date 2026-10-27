import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {migrate} from '../scripts/migrate.mjs';
import {decode,normalize,counts,transact} from '../data-v1.mjs';
test('migration preserves legacy table and multiline web events, task IDs and partial dates',async()=>{
 const tmp=await mkdtemp(tmpdir()+'/lifegress-test-'),src=tmp+'/source',dst=tmp+'/candidate';await mkdir(src+'/projects/work',{recursive:true});
 await writeFile(src+'/README.md','| TST-001 | [Test](projects/work/TST-001.md) | Active | Confirmed | - |\n');
 const text=`# Test
- **Stable Project ID:** TST-001
- **Project Name:** Test
- **Category:** work
- **Status:** Active
- **Status Confidence:** Confirmed
- **Recorded At:** 2026-01-01T00:00:00Z
## Task Checklist
- [x] **TST-001-T01** Example | Completed At: 2026-02 | Evidence: Owner
## Progress History
Source context.
| TST-001-E001 | 2026-01-01T00:00:00Z | Unconfirmed | Initial record | Owner | Source | Confirmed | Unknown | Active |
- **Event ID:** TST-001-WEB-abc
  - **Recorded At:** 2026-02-28T00:00:00Z
  - **Effective At:** 2026-02
  - **Change:** TST-001-T01: Pending → Completed
  - **Updated By:** Owner via Lifegress
  - **Evidence:** Owner-reviewed web edit
  - **Confidence:** Confirmed
## References
Owner
`;
 await writeFile(src+'/projects/work/TST-001.md',text);const r=await migrate(src,dst);assert.equal(r.tasks,1);
 const history=decode(await readFile(dst+'/sections/work/projects/TST-001/history/2026.md','utf8'));assert.equal(history.events.length,2);const event=history.events.find(e=>e.event_id==='TST-001-WEB-abc');assert.equal(event.entity_id,'TST-001-T01');assert.equal(event.occurred_at,'2026-02');assert.equal(event.actor,'Owner via Lifegress');assert.match(event.source_text,/Confidence/);
 assert.equal(decode(await readFile(dst+'/sections/work/projects/TST-001/tasks.md','utf8')).records[0].actual_completion,'2026-02');assert.equal(await readFile(src+'/projects/work/TST-001.md','utf8'),text);
 await assert.rejects(migrate(src,dst),/exists/);
});
