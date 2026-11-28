import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const {loadLocalPrimaryModule}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {parsePublicPublicationTerms,isPublicationTermsChoice}=loadLocalPrimaryModule('publication-consent-terms');

test('public notices expose only recognized category and restriction codes',()=>{
 assert.equal(isPublicationTermsChoice(undefined),false);
 assert.equal(isPublicationTermsChoice('none'),true);
 assert.equal(isPublicationTermsChoice('view-only'),true);
 assert.equal(parsePublicPublicationTerms(undefined),undefined);
 assert.deepEqual(parsePublicPublicationTerms([{category:'text-field:description',terms:'view-only'}]),[{category:'text-field:description',terms:'view-only'}]);
 assert.throws(()=>parsePublicPublicationTerms([{category:'phone',terms:'none',subjectEmail:'fixture@example.invalid'}]));
 assert.throws(()=>parsePublicPublicationTerms([{category:'text-field:email',terms:'none'}]));
 assert.throws(()=>parsePublicPublicationTerms([{category:'phone',terms:'anything'}]));
 assert.throws(()=>parsePublicPublicationTerms([{category:'phone',terms:'none'},{category:'phone',terms:'view-only'}]));
});
