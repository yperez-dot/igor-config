import test from "node:test";
import assert from "node:assert/strict";
import { personalOpenLeads } from "../src/ghl-personal.js";
import { ghlOpsBriefText } from "../src/worker-core.js";

test("Smart List matches exact tag and owner, excludes removed leads and paginates", async () => {
  let pages = 0;
  const result = await personalOpenLeads({ token: "test", locationId: "loc", userId: "owner", removals: [{subject:"maria lopez"}], fetchImpl: async (url, init) => {
    assert.match(url,/contacts\/search$/);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.filters,[{field:"tags",operator:"eq",value:"active_prospect"},{field:"assignedTo",operator:"eq",value:"owner"}]);
    assert.equal(body.page, ++pages);
    const contact = (id,name,assignedTo="owner",tags=["active_prospect"])=>({id,contactName:name,assignedTo,tags});
    const contacts = pages === 1 ? [contact("removed","María López"),contact("other","Private other lead","other"),contact("wrongtag","Not open","owner",["prospect"]),...Array.from({length:97},(_,i)=>contact(`a${i}`,`Lead ${i}`))] : [contact("last","Last lead")];
    return {ok:true,json:async()=>({contacts,total:101})};
  }});
  assert.equal(pages,2);
  assert.equal(result.leads.length,98);
  assert.equal(result.truncated,false);
  assert(result.leads.some(x=>x.name==="Last lead"));
  const text = ghlOpsBriefText({openLeads:result.leads,tasks:[],appointments:[]});
  assert.match(text,/Open Leads \(GHL Smart List\): 98/);
  assert.doesNotMatch(text,/María|Private|Not open/);
});

test("API failure and malformed data never become a false empty Smart List", async () => {
  for (const response of [{ok:false,status:403,json:async()=>({message:"Forbidden"})},{ok:true,json:async()=>({})}]) {
    await assert.rejects(()=>personalOpenLeads({token:"test",locationId:"loc",userId:"owner",fetchImpl:async()=>response}));
  }
  assert.match(ghlOpsBriefText({openLeadError:"Forbidden",tasks:[],appointments:[]}),/Open leads: unavailable from GHL/);
});
