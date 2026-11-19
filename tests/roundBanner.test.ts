import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roundBannerCourseId,roundBannerSatellite} from '../src/lib/roundBanner.ts';
const id='00000000-0000-4000-8000-000000000001';
const bounds={south:40.70,north:40.71,west:-74.01,east:-74};
test('typed course with town coordinates has no imagery identity',()=>{assert.equal(roundBannerCourseId(undefined),undefined);assert.equal(roundBannerCourseId('Central Park Golf'),undefined);assert.equal(roundBannerSatellite(undefined,bounds),null)});
test('only valid outline attached to persisted venue permits satellite',()=>{assert.equal(roundBannerCourseId(id),id);assert.deepEqual(roundBannerSatellite(id,bounds),{lat:40.705,lng:-74.005,bounds});assert.equal(roundBannerSatellite(id,{...bounds,north:90}),null);assert.equal(roundBannerSatellite(id,null),null);assert.equal(roundBannerSatellite(id,bounds,true),null)});
