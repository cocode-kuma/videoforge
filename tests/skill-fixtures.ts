import type {CreativeHarness} from '../plugins/cocode-director/harness.js';

/** Exercise the real reading tools before testing independent creation behavior. */
export async function readAllSkills(harness:CreativeHarness) {
  const tool=harness.tools().find(t=>t.name==='read_skill')!;
  for(const path of await harness.knowledge.requiredSkills()){
    let offset=0;
    for(;;){const page:any=await tool.execute({path,offset,length:32000});if(page.nextOffset===null)break;offset=page.nextOffset;}
  }
}
