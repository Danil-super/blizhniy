import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const source=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
test('catalogue and owner photos fill their frames without letterboxing',()=>{
 for(const file of ['components/listings/ListingCard.tsx','components/listings/CabinetListingCard.tsx','components/listings/SavedListingPhotos.tsx']){
  assert.match(source(file),/object-cover/);assert.doesNotMatch(source(file),/object-contain/);
 }
});
test('listing gallery and placement previews use one 4:3 frame at every breakpoint',()=>{
 assert.match(source('components/listings/ListingMediaGallery.tsx'),/aspect-\[4\/3\]/);
 assert.doesNotMatch(source('components/listings/ListingMediaGallery.tsx'),/aspect-square/);
 assert.doesNotMatch(source('components/listings/ListingCard.tsx'),/sm:aspect-square/);
 assert.match(source('components/listings/ListingFormControls.tsx'),/aspectRatio=\{4\/3\}/);
 assert.match(source('components/listings/ListingFormControls.tsx'),/outputSize=\{1600\}/);
});
test('placement explanation aligns vertically with the action buttons',()=>{
 assert.match(source('components/listings/ListingPages.tsx'),/flex flex-wrap items-center gap-3/);
 assert.match(source('components/listings/PrimaryListingFormButton.tsx'),/self-center/);
});
