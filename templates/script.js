/* ========================================= */
/* script.js */
/* ========================================= */

function atualizarRelogio(){

const agora = new Date();

document.getElementById('clock').innerHTML =
agora.toLocaleDateString() +
" - " +
agora.toLocaleTimeString();

}

setInterval(atualizarRelogio,1000);

atualizarRelogio();

/* CHART */

const ctx = document.getElementById('networkChart');

new Chart(ctx, {

type:'line',

data:{

labels:[
'20:27',
'20:28',
'20:29',
'20:30',
'20:31',
'20:32'
],

datasets:[{

label:'Conexões',

data:[12,19,15,25,18,31],

borderColor:'#00ff66',

backgroundColor:'rgba(0,255,102,0.08)',

borderWidth:2,

tension:0.4,

fill:true,

pointRadius:3,

pointBackgroundColor:'#00ff66'

}]

},

options:{

responsive:true,

plugins:{

legend:{

labels:{
color:'#00ff66'
}

}

},

scales:{

x:{

ticks:{
color:'#00ff66'
},

grid:{
color:'rgba(0,255,100,0.05)'
}

},

y:{

ticks:{
color:'#00ff66'
},

grid:{
color:'rgba(0,255,100,0.05)'
}

}

}

}

});