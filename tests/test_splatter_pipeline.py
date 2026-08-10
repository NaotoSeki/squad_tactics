import json, subprocess, tempfile, unittest
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/splatter_pipeline/generate_dirt_blockout.py'

class SplatterPipelineTest(unittest.TestCase):
    def test_generates_separate_rgba_passes_and_fail_closed_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)/'out'; subprocess.run(['python',str(SCRIPT),'--out',str(out)],check=True,cwd=ROOT)
            manifest=json.loads((out/'manifest.json').read_text())
            self.assertFalse(manifest['promotionAllowed']); self.assertEqual('pending',manifest['humanAB']['status'])
            self.assertEqual(48,manifest['frameCount']); self.assertEqual([80,100],manifest['anchorPx'])
            for name in manifest['passes']:
                frames=sorted((out/name).glob('*.png')); self.assertEqual(48,len(frames))
                for frame in frames:
                    with Image.open(frame) as im:
                        self.assertEqual(('RGBA',(160,128)),(im.mode,im.size))
                        pixels=list(im.getdata()); self.assertFalse(any(a==0 and (r or g or b) for r,g,b,a in pixels))
            with Image.open(out/'atlas.png') as atlas: self.assertLessEqual(atlas.width,2048)
            self.assertEqual(set(manifest['passes']),set(manifest['passAtlases']))
            for filename in manifest['passAtlases'].values(): self.assertTrue((out/filename).is_file())
            provenance=json.loads((out/'provenance.json').read_text())
            self.assertFalse(provenance['referencePixelsUsed']); self.assertFalse(provenance['trainingOrConditioningUsed'])
            metrics=json.loads((out/'metrics.json').read_text())
            self.assertTrue(metrics['summary']['bodyExcludesContactShadow'])
            self.assertIn('centroid',metrics['frames'][12]['body'])

    def test_runtime_preview_is_critic_only_and_url_gated(self):
        bridge=(ROOT/'phaser_bridge.js').read_text(encoding='utf-8')
        self.assertIn("psFxParams.get('splattercritic') === '1'",bridge)
        self.assertIn('localhost|127\\.0\\.0\\.1',bridge)
        self.assertIn('CRITIC ONLY / REJECT UNTIL A/B',bridge)
        packs=(ROOT/'fx_pack_registry.js').read_text(encoding='utf-8')
        self.assertIn('impact_splatter:null',packs)

    def test_checked_candidate_remains_rejected(self):
        package=ROOT/'asset/generated/splatter/dirt_blockout_v1'
        report=json.loads((package/'critic_report.json').read_text(encoding='utf-8'))
        self.assertEqual('rejected-before-human-ab',report['decision'])
        self.assertFalse(report['promotionAllowed'])
        self.assertGreaterEqual(len(report['automaticFailures']),4)
        for key in ('zoomLow','zoomMid','zoomHigh'):
            self.assertTrue((package/report['evidence'][key]['path']).is_file())

if __name__=='__main__': unittest.main()
