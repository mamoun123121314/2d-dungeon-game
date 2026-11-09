import lameenc, numpy as np, soundfile as sf, base64
SR=44100
NAMES='swing hit crit enemyHurt enemyDie bite hurt magic magicHit chest gold loot levelup telegraph reveal comboUp bounty boom bossSlam bossHit summon charge phase playerHurt potion door locked unlock crate stairs slam dodge miss buy sell ui error heartbeat necroCast'.split()
DOC={
'swing':'SWSH_Swoosh_OS_02','miss':'SWSH_Swoosh_OS_05',
'dodge':'SWSH_Swoosh_OS_05 + CLOTHMvmt_MovementWithGear_OS_01',
'hit':'FGHTImpt_PunchRegular_OS_03 + METLImpt_MetalHitSurface_OS_04',
'crit':'FGHTImpt_PunchHardest_OS_01 + METLImpt_HammerAnvil_OS_01 + GOREBone_SkullCracking_OS_01',
'bossHit':'METLImpt_MetalHitSurface_OS_02 + FGHTImpt_PunchHardest_OS_01',
'slam':'FGHTImpt_PunchHardest_OS_01 + WOODImpt_LargeWoodDrop_OS_01',
'bossSlam':'FGHTImpt_PunchHardest + LargeWoodDrop + BonesBreaking',
'boom':'WOODImpt_LargeWoodDrop_OS_01 + METLImpt_MetalObjDrop_OS_01',
'crate':'WOODImpt_LargeWoodDrop_OS_01 + CERMImpt_CeramicSmallImpact_OS_01',
'enemyHurt':'VOXMale_Male01Hurt_OS_01',
'enemyDie':'VOXMale_Male02Death_OS_01 + GOREBone_BonesBreaking_OS_01',
'bite':'ANMLDog_DogBark_OS_01 + CERMImpt_CeramicSmallImpact_OS_01',
'hurt':'ANMLDog_DogAttention_OS_01',
'playerHurt':'VOXEfrt_Male02Effort_OS_01 + METLImpt_MetalHitSurface_OS_04',
'necroCast':'VOXMale_GroanCreepy_OS_01 + CREAMnstr_CreatureCreepy_OS_01',
'summon':'CREAMnstr_CreatureCreepyReverb_OS_01','phase':'CREAMnstr_CreatureCreepyReverb_OS_01',
'charge':'CREAHmn_TrollLaugh_OS_01 + SWSH_Swoosh_OS_02',
'telegraph':'CREAMnstr_CreatureCreepy_OS_01',
'magic':'MAGSpel_MagicSpell_OS_01 + UIAlert_MusicTone_OS_02',
'magicHit':'MAGSpel_MagicSpell_OS_01 + METLImpt_MetalHitSurface_OS_02',
'reveal':'UIAlert_MusicTone_OS_04 + MAGSpel_MagicSpell_OS_02',
'levelup':'UIAlert_MusicTone_OS_01/03 + MAGSpel_MagicSpell_OS_01',
'gold':'OBJCoin_CoinDrop_OS_01','sell':'OBJCoin_CoinDrop_OS_01',
'loot':'OBJCoin_CoinDrop_OS_01 + OBJKey_KeyDrop_OS_01',
'chest':'OBJBag_KnapsackLeatherOpen + HammerAnvil + CoinDrop',
'buy':'OBJCoin_CoinDrop_OS_01 + UIClick_CasualPopsConfirm_OS_01',
'bounty':'CoinDrop + MusicTone_OS_03 + HammerAnvil',
'comboUp':'UIClick_CasualPopsConfirm_OS_01 + OBJKey_KeyDrop_OS_01',
'door':'DOORWood_FrontDoorOpen_OS_01','locked':'MECHLock_DoorLockKey_OS_01',
'unlock':'MECHLock_DoorUnlockKey_OS_01',
'stairs':'FEETHmn_ShoeConcreteWalk_OS_02 x3 + WOODFric_CreaksCreepy_OS_01',
'potion':'PLASImpt_PlasticBottleDrop_OS_01 + UIAlert_MusicTone_OS_02',
'ui':'UIClick_CasualPopsConfirm_OS_01','error':'UIAlert_CasualPopsError_OS_01',
'heartbeat':'FGHTImpt_PunchRegular_OS_03 (pitched down)',
}
pairs=[]
for n in NAMES:
    d,_=sf.read(f'/home/user/sfx-src/wav/{n}.wav',dtype='float32')
    pcm=(np.clip(d,-1,1)*32767).astype(np.int16).tobytes()
    e=lameenc.Encoder(); e.set_bit_rate(64); e.set_in_sample_rate(SR); e.set_channels(1); e.set_quality(5)
    raw=e.encode(pcm)+e.flush()
    pairs.append((n,base64.b64encode(raw).decode(),len(raw),len(d)/SR))
head = """  /* ==================== sound samples (real recordings) ====================
     Every impact, creature and interface sound in the game is a real
     recording — no oscillator is used anywhere in the sound effects.

     Source: the Oculus Audio Pack, published by Meta in
     https://github.com/facebookincubator/Meta-open-sound under CC0 1.0
     (public domain, no attribution required). The clips below were trimmed to
     their transient, layered, EQ'd and given a short stone-room tail, then
     encoded to 64 kbps mono MP3 and inlined as base64 so the game stays a
     single self-contained file that also runs from file:// offline.

     Layer sources, one line per effect (names as they appear in the pack):
"""
lines=[head]
for n,_,_,_ in pairs:
    lines.append('       %-11s %s\n' % (n, DOC[n]))
tail = """     ====================================================================== */
  const CLIPS = {
"""
body=[]
for n,b64,sz,dur in pairs:
    body.append("    %s: '%s',\n" % (n,b64))
out=''.join(lines)+tail+''.join(body)+'  };\n'
open('/home/user/sfx-src/clips.js','w').write(out)
print('clips.js %.1f KB | mp3 %d B | clips %d' % (len(out)/1024, sum(p[2] for p in pairs), len(pairs)))
print('longest %.2fs' % max(p[3] for p in pairs))
