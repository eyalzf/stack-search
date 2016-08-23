var stackexchange = require('stackexchange')
var Entities = require('html-entities').AllHtmlEntities

var entities = new Entities();
const options = { version: 2.2 }
let context = new stackexchange(options)

let searchQuery = {
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

module.exports = function(robot) {

  robot.respond(/debug/, function(msg) {

    console.log(msg.robot.name)
    console.log(msg.message.text)
    console.log(msgTxt)
  })

  // Listen to anyone approaching this bot
  robot.respond(/.*/, function(msg) {

    // Extract the actual question
    let botNameRegEx = new RegExp("@*" + msg.robot.name + ":*")
    let msgTxt = msg.message.text.replace(botNameRegEx, '').trim()

    let userId = msg.message.user.id

    // Check if user already asked a question
    let userData = robot.brain.get(userId)
    if (userData) {
      let msgIdx = parseInt(msgTxt)

      // If not a number assume its a new question
      if (!isNaN(msgIdx)) {

        // Check that the user provided a valid question number
        if (msgIdx < 1 || msgIdx > userData.questions.length) {
          msg.reply('Didn\'t get that.. here are the options again:\n' + formatPossibleQuestions(userData.questions))
          return
        }

        // Answer question
        answerQuestion(userData.questions[msgIdx - 1].question_id, userData.questions[msgIdx - 1].title, msg)

        // Clear user question
        robot.brain.remove(userId)

        return
      }
    }

    // Clear user question
    robot.brain.remove(userId)

    // If message is just one word don't run the search
    if (msgTxt.split(' ').length === 1) {
      msg.reply('Not quite sure what you expect me to do with *' + msgTxt + '*')
      return
    }

    searchQuery.q = msgTxt

    // Perform advanced search
    context.search.advanced(searchQuery, function(err, response) {
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
  });
}

function answerQuestion(qId, qTitle, msg) {

  msg.send('Here is what I know about *' + qTitle + "*")
  context.questions.answers(questionQuery, function(err, response) {
    if (err) {
      console.error('Answer error', err);
      msg.send('Oh oh.. something went wrong with answers', err)
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

    msg.send('Hmmm.. couldn\'t find an answer')

  }, [qId])
}

function formatPossibleQuestions(questions) {
  let str = ""

  questions.forEach((q, idx) => {
    str += (idx + 1) + ") *" + q.title + "*\n"
  })

  return str
}
