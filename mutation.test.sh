#!/bin/bash
# Test di mutazione: inietta bug deliberati e verifica che il fuzzer li catturi.
run_mutant() {
  local name="$1"; local sedexpr="$2"
  cp index.html index.mutant.bak
  sed -i "$sedexpr" index.html
  if node fuzz.test.js > /dev/null 2>&1; then
    echo "FAIL  il fuzzer NON ha catturato il mutante: $name"
    RESULT=1
  else
    echo "OK    mutante catturato: $name"
  fi
  mv index.mutant.bak index.html
}
RESULT=0
run_mutant "doppio sigillo permesso"            "s/if(state.lastSealed===tk) return 'already';//"
run_mutant "rollover non archivia le compiute"  "s/state.quests=state.quests.filter(q=>!q.fatto);/;/"
run_mutant "streak non si spezza"               "s/state.streak=0; \/\* un giorno saltato spezza la catena \*\///"
run_mutant "id duplicati ammessi"               "s/while(seen.has(id)) id=coreUid();//"
run_mutant "titoli non-stringa ammessi"         "s/clampStr(q.titolo,LIMITS.TITLE).trim()/q.titolo/"
run_mutant "trascritto accumulato (bug iOS)"    "s/let sessionFinal='',interim='';/var sessionFinal=accumFromResults._c=(accumFromResults._c||''),interim='';/"
exit $RESULT
