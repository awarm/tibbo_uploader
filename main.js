//var net_addr = "192.168.123.255";
net_addr = "10.0.50.255";


const files_path = "./";

const dgram = require('dgram'),
	  clui = require('clui'),
//      clc = require('cli-color'),
//      Line = clui.Line,
      Spinner = clui.Spinner,
      Progress = clui.Progress,
	  inquirer = require('inquirer'),
	  fs = require('fs');

const shortSearch = 2, longSearch = 8;
const countdown = new Spinner('Поиск устройств. Найдено [0] Осталось 10 секунд...  ', ['|', '/', '-', ' ']);// ['⣾','⣽','⣻','⢿','⡿','⣟','⣯','⣷']);
const m2 = [
  	"Загрузка прошивки" ,
  	{ name: "Загрузка firmware" },
  	"Перезагрузка",
  	new inquirer.Separator(),
  	"Выход",
  ];
// const confirmMenu = [
// 	"Да", "Нет"
// ]
const client = dgram.createSocket('udp4');



var number = shortSearch;
var mode = 1; // work mode - 1: search devices, 2 - uploading
var devices = []; // device list
var progressbar;
var step = 1; //upload step
var stopTimer;
var mac=""; // current device mac address
var fdata =[]; // uploading file content
var pageNumber = 0; // page of uploading file
var session = (Math.random() * 0xFFFFFFFF).toString(16);  // work session
var pr;
var firmvare = 0;


// **
// Get work network interface 
// used for create disable stoofing filter command 
// **
function getInterface(){
	var net = require('os').networkInterfaces();
	for (var ifs in net) {
		var res = net[ifs].find(ip => {
			return ip.address.includes(net_addr.substring(0,net_addr.length-3))
		});
		if (res)
		 return ifs;
	}
	return "unknown";
}
// function confirm(message){
// 	var deferred = Q.defer();
// 	showMenu(confirmMenu, message, (choice)=>{
// 		console.log(choice)
// 		if (choice == "Да")
// 			deferred.resolve(true);
// 		else
// 			deferred.reject(false);
// 	})
// 	return deferred.promise;
// }

function toBytesInt16(num){
    return [(num & 0xff00) >> 8,(num & 0x00ff)];
}
// **
// Send command to device
// **
function send(cmd,addr,msg,result){ 
	var mess = "_"+addr+cmd+ (msg? "|"+msg :"");
	client.send(mess,0,mess.length,65535,net_addr,result);
}
// **
// process error result
// **
function result(err,bytes) {
 	if (err) throw err;
};
function getFilesInDirectory (path,ext) {
    let dir = fs.readdirSync( path );
    return dir.filter( elm => elm.match(new RegExp(`.*\.(${ext})$`, 'ig')));
  }
function getFile(path){
    return fs.readFileSync(path);
  }

console.log("")
console.log("Программа обновления прошивки для устройств Tibbo");
console.log("")

// attach events
client.on('listening', () =>{ // udp net binding
	client.setBroadcast(1);
	startSearch();
});
var tm;
client.on('message',(msg,rinfo) => { // udp message recived
	var m = msg.toString(); // message string from Buffer
	var addr = msg.toString().substring(0,25); // device mac address
	switch (mode){
		case 1:{ // поиск устройств
			var d = devices.find(obj => { return obj.mac === addr });
			if (!d){
				devices.push({mac: addr, ip: rinfo.address});
				// get device information
				client.send("_"+addr+ "X",65535,net_addr);
			}else
			{
				if (m.indexOf('/') >0){
					if (m.indexOf('/')==m.lastIndexOf('/')){
						d.platform = m.substr(26,m.length-27);
						d.app_version = ""
					}else{
						d.platform = m.substr(27,m.indexOf('/')-28);
						d.app_version = m.substr(m.lastIndexOf('/')+1);
					}
				}else
				if ( !d.platform || d.app_version){ // requery if information not full
					client.send("_"+addr+ "X",65535,net_addr);
				}
			}
			countdown.message ("Поиск устройств. Найдено [" + devices.length + "] Осталось "+number+" секунд...  ");
			break;
		}
		case 2:{ // Программирование
			switch (step){
				case 1: // switch device to update mode
					if (m.indexOf(session)<=0)
						return;
					if (addr == mac){
						step=2; // send first data blocks
						var cmdd="Q";
						if (firmware==1)
							cmdd="QF";
						send(cmdd,mac,session);
						tm = setInterval(function(){
							var cmdd="Q";
							if (firmware==1)
								cmdd="QF";
							send(cmdd,mac,session);
						},500); // resend every 0.5 sec
					}else{
						console.log("ERROR - wrong reply",)
					}
					break;
				case 2: // sending first block
					if (pageNumber == 0 && addr == mac && m.indexOf(session>0)) 
						if (tm){
							clearInterval(tm);
						}
						progressbar = new Progress(20);
						process.stdout.write("\u001b[1000D"+progressbar.update(pageNumber,fdata.length/128))
						stopTimer = setTimeout(()=>{
//							clearInterval(pr);
							console.log();
							console.log("ОШИБКА:  Ответ от устройства не получен!");
							console.log("Возможно включена защита от Spoofing'а");
							console.log("Для отключения выполните комманду : ");
							console.log("\tsudo sysctl net.ipv4.conf.all.rp_filter=0 && sudo sysctl net.ipv4.conf." +getInterface()+ ".rp_filter=0");
							console.log();
							process.exit();
						},15000)
						sendFilePage();
					break;
				case 3: // wait confirm block recieved switch to this mode in sendFilePage()
					var b = toBytesInt16(pageNumber);
					if (pageNumber >= 0 && addr == mac)
					{
						if (stopTimer) { // stop wrong net config check timer
							clearTimeout(stopTimer);
							stopTimer=null;
						}
						var b11 = Buffer.from([0x41,b[0],b[1]]) // number of confirmed block
						if (msg.compare(b11,0,3,25)==0){
							pageNumber++; // change current block number
							process.stdout.write("\u001b[1000D"+progressbar.update(pageNumber,fdata.length/128))

							if (((pageNumber)*128) >= fdata.length-1){ // if last block confirmed
								step = 4; // switch to final step
								if (firmware==1)
									send("N",mac,session); // switch device to normal mode
								else
                                                                 	send("T",mac,session); // switch device to normal mode
							}
							else
								sendFilePage();

						}
					}
					break;
				case 4: // get last success message and switch to search mode
					if (addr == mac && msg[25]==0x41){ 
						clearTimeout(stopTimer);
						send("E",mac,session); // send reboot command to device (if it id not auto reboot)
						console.log("");
						console.log("Загрузка завершена успешно");
						console.log("");
						mode = 1;
						step = 1;
						number = longSearch; // long time search for wait to device reboot and network ready
						fdata = []; // clear file content buffer
						startSearch(); 
					}
			}
		}
	}
});

client.on('close', function() {
    console.log('Соединение неожиданно было закрыто. Проверьте сетевое подключение.');
	console.log();
    process.exit();
});

client.bind(45535); // bind socket


//**
// Get file names and show in menu
//**
function select_file(ext){
	console.log("");
	var filelist = getFilesInDirectory(files_path,ext);
  	filelist.push(new inquirer.Separator());
  	filelist.push("Отмена");

	showMenu(filelist,'Выберите файл для загрузки в '+mac,item =>{
		if (item.result == "Отмена"){
			process.exit();
		}
	 	console.log("OK");
	 	upload_application(mac,item.result);
	});
}

function upload_application(mac, filename){
	console.log("upload_application("+mac+","+filename+")" );
	var d = devices.find(obj => { return obj.mac === mac });
	var platform = d.platform.substring(1,d.platform.lastIndexOf('.'));
	console.log("Начинается загрузка");
	fdata = getFile(files_path+filename);
	var fst = fdata.indexOf(String.fromCharCode(0)+"<FD>")+5;
	var fen = fdata.indexOf(String.fromCharCode(0)+String.fromCharCode(0)+String.fromCharCode(0),fst);
	var line = fdata.toString('ascii',fst+1,fen-1);
	var finfo = line.split(String.fromCharCode(0));
	if (firmware==0 && fdata.indexOf(platform)<0){
		console.log("Выбрана неподходящая платформа :");
		console.log("Устройство: "+platform+", файл:" +finfo[2]);
		select_file(firmware==0?"tpc":"bin");
		return;
	}
	mode = 2; //switch to uploading mode
	step=1; // init device step
	pageNumber = 0;
	// init sending
	send("X",mac,session); // switch device to program mode
}

function sendFilePage(){
	step = 3;
	clearTimeout(stopTimer); // clear resend timer
	var bmac = Buffer.from("_"+mac);
	var n = toBytesInt16(pageNumber);
	var cmd = Buffer.from([0x44,n[0],n[1]]);
	var f = Buffer.from(fdata.slice(128*pageNumber,128*(pageNumber+1)));
	var mess = Buffer.concat([bmac,cmd,f]);
	client.send(mess,0,mess.length,65535,net_addr,result);
	if (fdata.length/128 >pageNumber)
		stopTimer = setTimeout(sendFilePage,500); // resend every 0.5 sec
}


function startSearch(){
	if (number<=0)
		number = shortSearch;
	devices = [];
	session = (Math.random() * 0xFFFFFFFF).toString(16); // change session
	countdown.start();
	// get device list;
	pr = setInterval(()=>{
		send("","?","");
		countdown.message( "Поиск устройств. Найдено [" + devices.length + "] Осталось "+number+" секунд...  ");
		if (number == 0){
			clearInterval(pr);
			countdown.stop();
			proc();
		}
		number--;
	},1000);
	send("","?","");
}

function proc(){
	
	if (devices.length == 0){
		console.log("ОШИБКА:  Устройства не найдены!");
		console.log("Возможно включена защита от Spoofing'а");
		console.log("Для отключения выполните комманды : ");
		console.log("\tsudo sysctl net.ipv4.conf.all.rp_filter=0 && sudo sysctl net.ipv4.conf." +getInterface()+ ".rp_filter=0");		console.log();
		process.exit();
	}

    var m = [];
    var mlip = 0;
    var mlpl = 0;
    for (var i = 0; i < devices.length ; i++){
    	if (mlip < devices[i].ip.length)
    		mlip = devices[i].ip.length;
    	if (mlpl < devices[i].platform.length)
    		mlpl = devices[i].platform.length;
    }
  for (var i = 0; i < devices.length ; i++) {
  	m.push({ value: devices[i].mac, 
  		name: devices[i].mac.replace("[",'').replace("]",'') + " | "
  			+ devices[i].ip.padStart(mlip," ") + " | " 
  			+ devices[i].platform.padEnd(mlpl," ") + " | "
  			+ devices[i].app_version });
  }
  m.push(new inquirer.Separator());
  m.push({ key:'0', value: "Выход" });

  showMenu(m,"Выберите устройство",function(item) {
  		if (item){
  			if (item.result == "Выход")
  				process.exit();
  			else
  				mac = item.result;
  				console.log("");
  				showMenu(m2,"Выберите действие",(select)=>{
  					//console.log(select);
  					if (select.result=="Выход"){
  						process.exit();
  					}

  					if (select.result == 'Загрузка прошивки'){
  						//console.log("select file");
						firmware=0;
  						select_file("tpc");
  					}
					if (select.result == 'Загрузка firmware'){
						firmware=1;
						select_file("bin");
					}
  					if (select.result == "Перезагрузка"){
  						send("E",mac,session);
  						number = longSearch;
  						startSearch();

  					}
  				})
  		}else
  		{
  			console.log("cancel")
  		}
  		//process.exit();
  	});
};
 

function showMenu(m,title,select){
	var q = {
      type: 'list',
      name: 'result',
      message: title,
      choices: m
    };
  inquirer.prompt(q)
  .then(select);
}
