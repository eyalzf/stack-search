const stackexchange = require('stackexchange')
const Entities = require('html-entities').AllHtmlEntities
const {Wit, log} = require('node-wit');
const parseString = require('xml2js').parseString
const request = require('request')
const queryString = require('query-string')

const STACK_SEARCH_WIT_TOKEN = process.env.WIT_TOKEN
const witClient = new Wit({
  accessToken: STACK_SEARCH_WIT_TOKEN
})

const STACK_SEARCH_WOLFRAM_ALPHA_APPID = process.env.WOLFRAM_ALPHA_APPID

const GREETINGS = ['hi', 'hello', 'hi there', 'yo', 'hola!', 'what\'s up?', 'hello there', 'howdy', 'sup', 'ahoy', 'aloha', 'shalom', 'greetings']
const GRATITUDES = ['sure thing', 'any time', 'no problem', 'you\'re welcome', 'that\'s nothing', 'no trouble', 'don\'t mention it', 'always a pleasure']

const entities = new Entities();
const options = { version: 2.2 }
const stackExchangeContext = new stackexchange(options)

let stackExchangeSearchQuery = {
  site: 'stackoverflow',
  sort: 'relevance',
  order: 'desc',
  accepted: true,
  filter: '!9YdnS9cov',
  pagesize: 10
}

let questionQuery = {
  site: 'stackoverflow',
  sort: 'activity',
  order: 'desc',
  filter: '!9YdnSM68f'
}

let wolframQuery = {
  appid: STACK_SEARCH_WOLFRAM_ALPHA_APPID,
  format: 'plaintext'
}

module.exports = function(robot) {

  robot.respond(/debug/, function(msg) {

    console.log(msg.robot.name)
    console.log(msg.message.text)
    console.log(msgTxt)
  })

  robot.respond(/test/, function(msg) {
    wolframQuery.input = 'parse string to int?'
    console.log('http://api.wolframalpha.com/v2/query?' + queryString.stringify(wolframQuery))
    request('http://api.wolframalpha.com/v2/query?' + queryString.stringify(wolframQuery), function(err, res, body) {
      if (err || res.statusCode !== 200) {
        console.error('Wolfram error', err)
        return
      }

      parseString(body, function (err, result) {
          console.log('Success: ', result.queryresult.$.success)
          console.dir(JSON.stringify(result));
      });
    })
  })

  // Listen to anyone approaching this bot
  robot.respond(/.*/, function(msg) {

    // Extract the actual question
    let botNameRegEx = new RegExp("@*" + msg.robot.name + ":*")
    let msgTxt = msg.message.text.replace(botNameRegEx, '').trim()

    // See if this is a response for question choice
    if (handleUserQuestionChoice(msgTxt, msg, robot)) return

    // See if this is a request for more details
    if (handleWolframMoreDetails(msgTxt, msg, robot)) return

    witClient.message(msgTxt, {})
    .then((data) => {

      console.log('Wit response', JSON.stringify(data))

      // Check if there's an intent
      if (data.entities.intent && data.entities.intent[0].confidence > 0.6) {
        let intent = data.entities.intent[0].value

        console.log('Intent: ', intent)

        // Greet back
        if (intent === "greeting") {
          msg.reply(msg.random(GREETINGS))
          return
        }

        // Thank gratitude
        if (intent === "gratitude") {
          let giphyPrefix = Math.random() >= 0.5 ? '/giphy ' : ''
          msg.reply(giphyPrefix + msg.random(GRATITUDES))
          return
        }

        // Say what this bot does
        if (intent === "help") {
          msg.reply('I\'m a technical wiz. Just ask me any technical question')
          return
        }
      }

      // Check if there's a technical question
      if (data.entities.question_body && data.entities.question_body[0].confidence > 0.5) {
        handleQuestion(data.entities.question_body[0].value, msg, robot)
        return
      }

      handleQuestion(msgTxt, msg, robot)
    })
    .catch((err) => {
      console.error('Wit error', err)
      handleQuestion(msgTxt, msg, robot)
    })
  });
}

function handleQuestion(questionTxt, msg, robot) {

  // Clear user question
  let userId = msg.message.user.id
  robot.brain.remove(userId)

  // If message is just one word don't run the search
  if (questionTxt.split(' ').length === 1 && !isNaN(parseInt(questionTxt.trim()))) {
    msg.reply('Not quite sure what you expect me to do with *' + questionTxt + '*')
    return
  }

  wolframQuery.input = questionTxt

  // Try a general question first
  request('http://api.wolframalpha.com/v2/query?' + queryString.stringify(wolframQuery), function(err, res, body) {

    // If error returned try a technical question
    if (err || res.statusCode !== 200) {
      console.error('Wolfram error', err)
      handleStackExchangeQuestion(questionTxt, msg, robot)
      return
    }

    parseString(body, function (err, result) {
        console.log('Wolfram response:', JSON.stringify(result));

        // If general question has no result try a technical question
        if (result.queryresult.$.success === 'false') {
          handleStackExchangeQuestion(questionTxt, msg, robot)
          return
        }

        // Get formatted answer
        let answerDetails = createWolframAnswer(result)

        // If no details try a technical question
        if (!answerDetails) {
          handleStackExchangeQuestion(questionTxt, msg, robot)
          return
        }

        // If there's a short answer show it and suggest more
        if (answerDetails.shortAnswer) {
          robot.brain.set(userId, {answerDetails: answerDetails})
          msg.send('Here is what I know about *' + answerDetails.identityTitle + '*')
          msg.send(answerDetails.shortAnswer)
          msg.reply('\nDo you want to know more?')
          return
        }

        // If no short answer just show the full details
        msg.send('Here is everything I know about *' + answerDetails.identityTitle + '*')
        msg.send(answerDetails.detailedAnswer)
    })
  })
}

function handleStackExchangeQuestion(questionTxt, msg, robot) {
  let userId = msg.message.user.id
  stackExchangeSearchQuery.q = questionTxt

  // Perform advanced search
  stackExchangeContext.search.advanced(stackExchangeSearchQuery, function(err, response) {
    if (err) {
      console.error('Search error', err);
      msg.send('Oh oh.. something went wrong with search', err)
      return
    }

    if (response.items.length === 0) {
      msg.reply('Wow.. this is too much for me, don\'t have an answer for you. Try rephrasing your question')
      return
    }

    if (response.items.length === 1) {
      answerQuestion(response.items[0].question_id, response.items[0].title, msg)
      return
    }

    // Get the top 3 questions
    let questions = response.items.sort((q1, q2) => {
      return q2.up_vote_count - q1.up_vote_count
    }).slice(0, 3);

    // Set the user questions
    robot.brain.set(userId, {questions: questions})

    msg.reply('I have several possible answers. Which describes best your question?\n' + formatPossibleQuestions(questions) + '\n\nIf none of the above fits, you need to refine your question')
  })
}

function handleUserQuestionChoice(questionTxt, msg, robot) {
  let userId = msg.message.user.id

  // Check if user already asked a question
  let userData = robot.brain.get(userId)
  if (userData && userData.questions) {
    let msgIdx = parseInt(questionTxt)

    // If not a number assume its a new question
    if (!isNaN(msgIdx)) {

      // Check that the user provided a valid question number
      if (msgIdx < 1 || msgIdx > userData.questions.length) {
        msg.reply('Didn\'t get that.. here are the options again:\n' + formatPossibleQuestions(userData.questions))
        return true
      }

      // Answer question
      answerQuestion(userData.questions[msgIdx - 1].question_id, userData.questions[msgIdx - 1].title, msg)

      // Clear user question
      robot.brain.remove(userId)

      return true
    }
  }

  return false
}

function answerQuestion(qId, qTitle, msg) {

  msg.send('Here is what I know about *' + entities.decode(qTitle) + "*")
  stackExchangeContext.questions.answers(questionQuery, function(err, response) {
    if (err) {
      console.error('Answer error', err);
      msg.send('Oh oh.. something went wrong with answers', err)
      return
    }

    if (response.items.length === 0) {
      msg.send('Hmmm.. couldn\'t find an answer')
      return
    }

    // Find the accepted answer
    let acceptedAnswer = response.items.find(function(answer) {
      return answer.is_accepted;
    })

    // Reply with accepted answer
    if (acceptedAnswer) {
      msg.send(entities.decode(acceptedAnswer.body_markdown))
      return
    }

    // Find best answer
    let bestAnswer = response.items.sort((a1, a2) => {
      return a2.score - a1.score
    })[0];

    msg.send(entities.decode(bestAnswer.body_markdown))

  }, [qId])
}

function formatPossibleQuestions(questions) {
  let str = ""

  questions.forEach((q, idx) => {
    str += (idx + 1) + ") *" + entities.decode(q.title) + "*\n"
  })

  return str
}

function handleWolframMoreDetails(questionTxt, msg, robot) {
  let userId = msg.message.user.id

  // Check if user replyed yes to more details
  let userData = robot.brain.get(userId)
  if (userData && userData.answerDetails) {

    // Check if msg is 'yes'
    if (questionTxt.toLowerCase().trim() === 'yes') {
      msg.send(userData.answerDetails.detailedAnswer)
      return true
    }
  }

  return false
}

function createWolframAnswer(result) {
  let answerDetails = {}

  // Get the identity pod to show actual search terms used
  let identityPod = result.queryresult.pod.find((pod) => {
    return pod.$.scanner === 'Identity'
  })

  // If no identity pods return an empty result
  if (!identityPod) return

  // Set the identity title
  answerDetails.identityTitle = identityPod.subpod[0].plaintext[0];

  let validPods = result.queryresult.pod.filter((pod) => {
    return pod.$.scanner !== 'Identity' && pod.subpod[0].plaintext[0] !== '' && pod.subpod[0].plaintext[0] !== '(data not available)'
  })

  // If no valid pods return an empty result
  if (validPods.length === 0) return

  // Get the primary response pod
  let primaryPod = validPods.find((pod) => {
    return pod.$.primary === 'true'
  })

  // Set the short answer from the primary pod
  if (validPods.length > 1 && primaryPod) {
    answerDetails.shortAnswer = primaryPod.subpod[0].plaintext[0]
  }

  // Create the detailed answer
  let detailedAnswer = ''
  validPods.forEach((pod) => {

    // Add the pod title
    detailedAnswer += '*' + pod.$.title + '*\n'

    // Add the subpods details
    pod.subpod.filter((subpod) => {
      return subpod.plaintext[0] !== '' && subpod.plaintext[0] !== '(data not available)'
    }).forEach((subpod) => {
      if (subpod.$.title !== '') {
        detailedAnswer += '_' + subpod.$.title + ':_\n'
      }

      detailedAnswer += subpod.plaintext[0] + '\n\n'
    })
  })

  answerDetails.detailedAnswer = detailedAnswer.trim()


  return answerDetails
}
