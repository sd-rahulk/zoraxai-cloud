'use strict';
const demoProfile = {firstName:'Alex',lastName:'Example',email:'alex@example.test',phone:'+12025550123',country:'United States'};
document.querySelector('#demo').addEventListener('click', async () => {
  const result = await ZoraxFormFiller.fill(demoProfile, {sampleChoices:document.querySelector('#samples').checked,overwrite:false}, {});
  document.querySelector('#result').textContent = JSON.stringify(result.results,null,2);
});
document.querySelector('#undoDemo').addEventListener('click', async () => {
  document.querySelector('#result').textContent = JSON.stringify(await ZoraxFormFiller.undo(),null,2);
});
document.querySelector('#practice').addEventListener('submit', event => event.preventDefault());
